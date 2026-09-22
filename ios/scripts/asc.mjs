#!/usr/bin/env node
// App Store Connect, asked directly. No package: a token signed with the API key (ES256 JWT) and fetch.
//
//   node ios/scripts/asc.mjs GET 'apps?filter[bundleId]=com.algernonlabs.seesubtitles'
//   node ios/scripts/asc.mjs POST profiles '{"data":…}'
//   node ios/scripts/asc.mjs profiles <dir> <bundle id>…   # App Store profiles for these ids, written as .mobileprovision
//   node ios/scripts/asc.mjs build <bundle id> <build>     # waits for a build to appear under the app; prints its state
//
// The key: APPLE_API_KEY_ID and APPLE_API_ISSUER (desktop/scripts/release.sh's names, normally from
// ~/.config/seesubtitles/notarize.env), APPLE_API_KEY the .p8 — beside notarize.env when unset.
import { createSign, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const keyId = process.env.APPLE_API_KEY_ID;
const issuer = process.env.APPLE_API_ISSUER;
if (!keyId || !issuer) { console.error('asc: APPLE_API_KEY_ID and APPLE_API_ISSUER are not set'); process.exit(2); }
const keyPath = process.env.APPLE_API_KEY || `${process.env.HOME}/.config/seesubtitles/AuthKey_${keyId}.p8`;

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = b64({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const key = createPrivateKey(readFileSync(keyPath));
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export async function api(method, path, body) {
  let r;
  // The link to Apple from here drops a request now and then: a GET gets three tries. A write gets one — a POST
  // whose answer was lost may well have happened (a profile made twice is a 409 on the second), and each caller
  // looks before it writes, so running it again is the retry.
  for (let attempt = 1; ; attempt++) {
    try {
      r = await fetch(`https://api.appstoreconnect.apple.com/v1/${path}`, {
        method, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
        body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), signal: AbortSignal.timeout(60_000),
      });
      break;
    } catch (e) { if (attempt >= 3 || method !== 'GET') throw e; }
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) {
    const e = json && json.errors && json.errors[0];
    throw new Error(`${method} ${path} → ${r.status}${e ? ` ${e.title}: ${e.detail}` : ` ${text.slice(0, 200)}`}`);
  }
  return json;
}

/** The App Store profile for a bundle id, made when there is none, as the decoded .mobileprovision bytes. */
async function appStoreProfile(identifier, certificateId) {
  let ids = (await api('GET', `bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&fields[bundleIds]=identifier`)).data
    .filter((b) => b.attributes.identifier === identifier); // the filter matches prefixes too
  if (!ids.length) {
    console.log(`   registering ${identifier}`);
    ids = [(await api('POST', 'bundleIds', { data: { type: 'bundleIds', attributes: { identifier, name: identifier.replace(/[^A-Za-z0-9 ]/g, ' '), platform: 'IOS' } } })).data];
  }
  const bundleId = ids[0].id;
  const name = `${identifier} App Store`;
  const existing = (await api('GET', `profiles?filter[name]=${encodeURIComponent(name)}&filter[profileType]=IOS_APP_STORE&fields[profiles]=name,profileState,profileContent`)).data
    .filter((p) => p.attributes.name === name);
  for (const p of existing) {
    if (p.attributes.profileState === 'ACTIVE') return Buffer.from(p.attributes.profileContent, 'base64');
    await api('DELETE', `profiles/${p.id}`); // invalid (a certificate it named has gone): made again below
  }
  console.log(`   making the App Store profile for ${identifier}`);
  const made = await api('POST', 'profiles', { data: { type: 'profiles', attributes: { name, profileType: 'IOS_APP_STORE' },
    relationships: { bundleId: { data: { type: 'bundleIds', id: bundleId } }, certificates: { data: [{ type: 'certificates', id: certificateId }] } } } });
  return Buffer.from(made.data.attributes.profileContent, 'base64');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'profiles') {
    const [dir, ...identifiers] = rest;
    mkdirSync(dir, { recursive: true });
    const certs = (await api('GET', 'certificates?filter[certificateType]=DISTRIBUTION&fields[certificates]=name,expirationDate')).data
      .filter((c) => new Date(c.attributes.expirationDate) > new Date());
    if (!certs.length) throw new Error('the team has no valid Apple Distribution certificate');
    for (const id of identifiers) writeFileSync(join(dir, `${id}.mobileprovision`), await appStoreProfile(id, certs[0].id));
  } else if (cmd === 'build') {
    const [bundleId, build] = rest;
    const apps = (await api('GET', `apps?filter[bundleId]=${encodeURIComponent(bundleId)}`)).data;
    if (!apps.length) { console.log(`   App Store Connect has no app record for ${bundleId} — make it at https://appstoreconnect.apple.com/apps`); process.exit(1); }
    // The builds list lags behind Apple by minutes; a prerelease version's own builds show one as soon as it arrives.
    for (let i = 0; i < 12; i++) {
      const v = await api('GET', `preReleaseVersions?filter[app]=${apps[0].id}&limit=3&include=builds`);
      const hit = (v.included || []).find((b) => b.type === 'builds' && b.attributes.version === build);
      if (hit) { console.log(`   Apple has build ${build}: ${hit.attributes.processingState}`); process.exit(0); }
      await new Promise((r) => setTimeout(r, 20_000));
    }
    console.log(`   build ${build} is not listed yet — check TestFlight in a few minutes`); process.exit(1);
  } else if (cmd === 'GET' || cmd === 'POST' || cmd === 'PATCH' || cmd === 'DELETE') {
    console.log(JSON.stringify(await api(cmd, rest[0], rest[1]), null, 1));
  } else {
    console.error('usage: asc.mjs GET|POST|PATCH|DELETE <path> [json] | profiles <dir> <bundle id>… | build <bundle id> <build>'); process.exit(2);
  }
} catch (e) { console.error(`asc: ${e.message}`); process.exit(1); }
