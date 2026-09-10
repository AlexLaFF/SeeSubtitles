#!/usr/bin/env node
'use strict';
// Refuse to call a build releasable unless macOS would actually open it on someone else's Mac.
//
// Every build up to 0.6.7 was signed with an "Apple Development" certificate and never notarized, which
// only launches on Macs registered to the team — so the DMGs published to seesubtitles.com/updates could
// not be opened by anyone else, and nothing in the process noticed. This is what noticing looks like.
//
//   node desktop/scripts/verify-release.js            the version in desktop/package.json
//   node desktop/scripts/verify-release.js 0.6.8      a specific version
//
// Exits non-zero, loudly, on anything a downloader would hit.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const version = process.argv[2] || require(path.join(ROOT, 'package.json')).version;
const failures = [];
const notes = [];

/** Run a command and return {ok, out}. codesign and spctl print their verdict on stderr even when they
 *  succeed, so both streams are merged — reading stdout alone silently sees nothing at all. */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function check(label, fn) {
  process.stdout.write(`  ${label} … `);
  try {
    const note = fn();
    console.log(note ? `✔ ${note}` : '✔');
  } catch (err) {
    console.log(`✖ ${err.message}`);
    failures.push(`${label}: ${err.message}`);
  }
}

const app = path.join(DIST, 'mac-arm64', 'See Subtitles.app');
const dmg = path.join(DIST, `See Subtitles-${version}-arm64.dmg`);
const zip = path.join(DIST, `See Subtitles-${version}-arm64-mac.zip`);

console.log(`\nVerifying See Subtitles ${version} in desktop/dist\n`);

check('the build exists', () => {
  for (const [what, file] of [['app bundle', app], ['dmg', dmg], ['zip', zip]]) {
    if (!fs.existsSync(file)) throw new Error(`no ${what} at ${path.relative(ROOT, file)} — run "npm run dist -w desktop" first`);
  }
  return `${(fs.statSync(dmg).size / 1e6).toFixed(0)} MB dmg`;
});

if (!failures.length) {
  check('signed by a Developer ID certificate', () => {
    const r = run('codesign', ['-dv', '--verbose=2', app]);
    const authority = (/^Authority=(.+)$/m.exec(r.out) || [])[1] || '(none)';
    if (/Apple Development/.test(authority)) {
      throw new Error(`signed by "${authority}" — a development certificate only launches on Macs registered to the team. `
        + 'Check that the Developer ID certificate is in the login keychain, or pin it with CSC_NAME.');
    }
    if (!/Developer ID Application/.test(authority)) throw new Error(`unexpected signing authority "${authority}"`);
    notes.push(authority);
    return authority;
  });

  check('the signature is intact', () => {
    const r = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    if (!r.ok) throw new Error(r.out.trim().split('\n').slice(-1)[0] || 'codesign --verify failed');
    return null;
  });

  check('the hardened runtime is on', () => {
    const r = run('codesign', ['-d', '--verbose=2', app]);
    if (!/flags=\S*runtime/.test(r.out)) throw new Error('the app is not built with the hardened runtime, so Apple will refuse to notarize it');
    return null;
  });

  check('Gatekeeper accepts the app', () => {
    const r = run('spctl', ['-a', '-vvv', '-t', 'install', app]);
    if (!r.ok || /rejected/.test(r.out)) {
      throw new Error(`spctl rejected it — ${(/source=(.+)$/m.exec(r.out) || [, 'not notarized'])[1].trim()}. This build would not open on another Mac.`);
    }
    const source = (/source=(.+)$/m.exec(r.out) || [, ''])[1].trim();
    if (!/Notarized/.test(source)) throw new Error(`accepted but source is "${source}" — it has to say Notarized Developer ID`);
    return source;
  });

  check('the notarization ticket is stapled to the dmg', () => {
    const r = run('xcrun', ['stapler', 'validate', dmg]);
    if (!r.ok) throw new Error('no stapled ticket — a downloader with no network, or behind a firewall, would be refused');
    return null;
  });

  check('latest-mac.yml points at this build', () => {
    const yml = path.join(DIST, 'latest-mac.yml');
    if (!fs.existsSync(yml)) throw new Error('no latest-mac.yml — electron-updater has nothing to read');
    const text = fs.readFileSync(yml, 'utf8');
    const found = (/^version:\s*(.+)$/m.exec(text) || [, ''])[1].trim();
    if (found !== version) throw new Error(`it names ${found}, not ${version}`);
    return null;
  });
}

if (failures.length) {
  console.log(`\n✖ NOT RELEASABLE — ${failures.length} problem${failures.length > 1 ? 's' : ''}:\n`);
  for (const f of failures) console.log(`   · ${f}`);
  console.log('\n  Notarization needs APPLE_API_KEY (path to the .p8), APPLE_API_KEY_ID and APPLE_API_ISSUER');
  console.log('  in the environment at build time. Nothing in electron-builder.yml has to change.\n');
  process.exit(1);
}

console.log(`\n✔ RELEASABLE — ${version}, ${notes.join(', ')}.`);
console.log('  This build opens on a Mac that has never seen your developer account.\n');
