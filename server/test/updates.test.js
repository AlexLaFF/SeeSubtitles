'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseLatest, latestRelease, latestIosRelease, compareVersions } = require('../lib/updates');

test('latest-mac.yml is summarised and the files checked on disk', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(latestRelease(dir), null);
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), "version: 0.3.0\nfiles:\n  - url: Subtitles-0.3.0-arm64-mac.zip\n    sha512: x\n    size: 1\npath: Subtitles-0.3.0-arm64-mac.zip\nreleaseDate: '2026-09-08T16:00:00.000Z'\n");
  fs.writeFileSync(path.join(dir, 'Subtitles-0.3.0-arm64-mac.zip'), 'z');
  fs.writeFileSync(path.join(dir, 'Subtitles-0.3.0-arm64.dmg'), 'd');
  assert.deepEqual(latestRelease(dir), { version: '0.3.0', dmg: 'Subtitles-0.3.0-arm64.dmg', zip: 'Subtitles-0.3.0-arm64-mac.zip', releaseDate: '2026-09-08T16:00:00.000Z' });
  assert.equal(parseLatest('version: "1.2.3"\n').version, '1.2.3');
});

test('version comparison', () => {
  assert.equal(compareVersions('0.3.0', '0.2.0'), 1);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.2.0-beta', '0.3.0'), -1);
});

test('only a published, installable iOS build is advertised', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-upd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(latestIosRelease(dir), null);
  const file = path.join(dir, 'latest-ios.json');
  fs.writeFileSync(file, JSON.stringify({ version: '1.0', build: 189, channel: 'testflight', url: 'https://testflight.apple.com/' }));
  assert.deepEqual(latestIosRelease(dir), { version: '1.0', build: 189, channel: 'testflight', url: 'https://testflight.apple.com/' });
  fs.writeFileSync(file, JSON.stringify({ version: '1.0', build: 190, channel: 'testflight', url: 'http://example.org/' }));
  assert.equal(latestIosRelease(dir), null);
});
