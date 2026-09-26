'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { listBackupFiles, archive } = require('../backup-archive');

test('backup keeps original audio, edits and session records but leaves out rebuildable files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name); };
  for (const name of [
    'platform.sqlite', 'platform.sqlite-wal', 'updates/latest-mac.yml', 'release-backups/0.8.3/old.dmg',
    'sessions/live.jsonl', 'jobs/audio/source.m4a', 'jobs/audio/audio.mp3', 'jobs/audio/cues.json',
    'jobs/audio/asr.json', 'jobs/audio/lecture.srt', 'jobs/audio/lecture.mp4',
    'jobs/video/source.mp4', 'jobs/video/audio.mp3', 'jobs/video/source.mp4.part',
    'jobs/video/cues.json', 'jobs/video/versions/1/cues.json', 'jobs/video/versions/1/version.json',
    'jobs/video/versions/1/old.mp4', 'jobs/video/subs.ass',
  ]) put(name);

  const withVideos = listBackupFiles(root, { keepVideoUploads: true });
  assert.ok(withVideos.includes('./sessions/live.jsonl'));
  assert.ok(withVideos.includes('./jobs/audio/source.m4a'));
  assert.ok(withVideos.includes('./jobs/video/source.mp4'));
  assert.ok(withVideos.includes('./jobs/video/versions/1/cues.json'));
  assert.ok(withVideos.includes('./jobs/video/versions/1/version.json'));
  assert.ok(withVideos.includes('./jobs/audio/lecture.srt'), 'small text export remains downloadable after restore');
  for (const missing of ['platform.sqlite', 'platform.sqlite-wal', 'updates/latest-mac.yml', 'release-backups/0.8.3/old.dmg',
    'jobs/audio/audio.mp3', 'jobs/audio/lecture.mp4', 'jobs/video/audio.mp3', 'jobs/video/source.mp4.part',
    'jobs/video/versions/1/old.mp4', 'jobs/video/subs.ass']) assert.ok(!withVideos.includes(`./${missing}`), missing);

  const withoutVideos = listBackupFiles(root, { keepVideoUploads: false });
  assert.ok(!withoutVideos.includes('./jobs/video/source.mp4'));
  assert.ok(withoutVideos.includes('./jobs/video/audio.mp3'), 'extracted audio is the sole recording when video is omitted');
  assert.ok(!withoutVideos.includes('./jobs/audio/audio.mp3'), 'audio extracted from an original audio file is redundant');
  const out = path.join(os.tmpdir(), `backup-${process.pid}-${Date.now()}.tgz`);
  t.after(() => fs.rmSync(out, { force: true }));
  archive(root, out, { keepVideoUploads: false });
  const archived = execFileSync('tar', ['-tzf', out], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(archived.sort(), withoutVideos.sort(), 'the archive contains exactly the selected files');

  const old = path.join(root, '..', `old-backups-${process.pid}-${Date.now()}`);
  const day = path.join(old, '2026-09-25');
  fs.mkdirSync(day, { recursive: true });
  t.after(() => fs.rmSync(old, { recursive: true, force: true }));
  const oldArchive = path.join(day, 'data.tgz');
  execFileSync('tar', ['-czf', oldArchive, '-C', root, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  execFileSync('python3', [path.join(__dirname, '../../deploy/repack-backups.py'), old, '--apply']);
  const repacked = execFileSync('tar', ['-tzf', oldArchive], { encoding: 'utf8' }).trim().split('\n')
    .filter((name) => name !== './' && !name.endsWith('/'));
  assert.deepEqual(repacked.sort(), withoutVideos.sort(), 'old archives are rewritten to the same selection');
  assert.equal(execFileSync('tar', ['-xOzf', oldArchive, './jobs/video/cues.json'], { encoding: 'utf8' }), 'jobs/video/cues.json');
});

test('an empty data directory still makes a valid archive', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-empty-'));
  const out = path.join(os.tmpdir(), `backup-empty-${process.pid}-${Date.now()}.tgz`);
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { force: true }); });
  assert.equal(archive(root, out), 0);
  assert.equal(execFileSync('tar', ['-tzf', out], { encoding: 'utf8' }), '');
});
