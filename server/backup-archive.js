'use strict';
// Select data for the nightly archive. The database is snapshotted separately by deploy/backup.sh.
// Keep unknown files by default: a new kind of user data must not silently disappear from backups.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VIDEO = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.ts']);

function listBackupFiles(root, { keepVideoUploads = false } = {}) {
  const files = [];
  const videoOnlyAudio = new Set();
  const jobs = path.join(root, 'jobs');
  if (fs.existsSync(jobs)) {
    for (const id of fs.readdirSync(jobs)) {
      const dir = path.join(jobs, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      const source = fs.readdirSync(dir).filter((name) => /^source\.[^.]+$/.test(name));
      // When an original video is omitted, its extracted audio is the only recording in the backup.
      if (!source.length || (!keepVideoUploads && source.some((name) => VIDEO.has(path.extname(name).toLowerCase())))) videoOnlyAudio.add(id);
    }
  }
  function visit(dir, relative = '') {
    for (const name of fs.readdirSync(dir)) {
      const rel = relative ? `${relative}/${name}` : name;
      const parts = rel.split('/');
      if (parts.length === 1 && (name === 'updates' || name === 'release-backups' || name.startsWith('platform.sqlite'))) continue;
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) { visit(full, rel); continue; }
      if (parts[0] === 'jobs' && parts.length >= 3) {
        if (name.endsWith('.part') || name === 'subs.ass') continue;
        if (name === 'audio.mp3' && !videoOnlyAudio.has(parts[1])) continue;
        if (/^source\.[^.]+$/.test(name) && VIDEO.has(path.extname(name).toLowerCase()) && !keepVideoUploads) continue;
        if (name.endsWith('.mp4') && name !== 'source.mp4') continue; // rendered video, including older versions
      }
      files.push(`./${rel}`);
    }
  }
  visit(root);
  return files.sort();
}

function archive(root, output, options) {
  const files = listBackupFiles(root, options);
  const result = spawnSync('tar', ['-czf', output, '--null', '-T', '-'], {
    cwd: root, input: Buffer.from(files.length ? `${files.join('\0')}\0` : ''), stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar failed with status ${result.status}`);
  return files.length;
}

if (require.main === module) {
  const root = process.argv[2] || '/data';
  const output = process.argv[3] || '/tmp/backup.tgz';
  const keepVideoUploads = process.env.BACKUP_VIDEO_UPLOADS === '1';
  const count = archive(root, output, { keepVideoUploads });
  console.log(`archived ${count} files${keepVideoUploads ? '' : ' (original video excluded)'}`);
}

module.exports = { listBackupFiles, archive };
