'use strict';
// Desktop app releases hosted by the server: <DATA_DIR>/updates holds what `electron-builder` produces
// (Subtitles-<v>-arm64.dmg, Subtitles-<v>-arm64-mac.zip, latest-mac.yml). electron-updater reads
// latest-mac.yml itself; /api/desktop/version summarises it for the manual-download fallback.
const fs = require('node:fs');
const path = require('node:path');

/** Parse the subset of latest-mac.yml we need (version, files, releaseDate) without a YAML library. */
function parseLatest(text) {
  const out = { version: null, files: [], releaseDate: null, path: null };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^version:\s*(.+)$/.exec(line))) out.version = m[1].trim().replace(/^['"]|['"]$/g, '');
    else if ((m = /^releaseDate:\s*(.+)$/.exec(line))) out.releaseDate = m[1].trim().replace(/^['"]|['"]$/g, '');
    else if ((m = /^path:\s*(.+)$/.exec(line))) out.path = m[1].trim();
    else if ((m = /^\s+-\s+url:\s*(.+)$/.exec(line))) out.files.push(m[1].trim());
  }
  return out;
}

/** {version, dmg, zip, releaseDate} for the newest published desktop build, or null. */
function latestRelease(dir) {
  try {
    const info = parseLatest(fs.readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8'));
    if (!info.version) return null;
    const present = (f) => f && fs.existsSync(path.join(dir, f)) ? f : null;
    const dmg = present(fs.readdirSync(dir).find((f) => f.endsWith('.dmg') && f.includes(info.version)));
    const zip = present(info.files.find((f) => f.endsWith('.zip')) || info.path);
    return { version: info.version, dmg, zip, releaseDate: info.releaseDate };
  } catch { return null; }
}

/** semver-ish compare: 1 if a > b, -1 if a < b, 0 if equal (pre-release tags ignored). */
function compareVersions(a, b) {
  const pa = String(a || '0').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0').split('-')[0].split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = { parseLatest, latestRelease, compareVersions };
