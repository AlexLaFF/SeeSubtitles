#!/usr/bin/env python3
"""Remove original videos and generated bulk files from existing data.tgz backups.

Run with --dry-run first. Each --apply rewrite is verified byte-for-byte for every
file kept, then atomically replaces one archive. The SQLite snapshot is untouched.
"""
import argparse
import hashlib
import os
from pathlib import Path
import tarfile
import tempfile

VIDEO = {'.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.ts'}


def normalized(name):
    return name.removeprefix('./').strip('/')


def source_video(name):
    base = name.rsplit('/', 1)[-1]
    return base.startswith('source.') and Path(base).suffix.lower() in VIDEO


def decide(name, video_jobs, source_jobs):
    rel = normalized(name)
    parts = rel.split('/')
    if not rel or parts[0] in ('updates', 'release-backups') or parts[0].startswith('platform.sqlite'):
        return False
    if parts[0] != 'jobs' or len(parts) < 3:
        return True
    base = parts[-1]
    job = parts[1]
    if base.endswith('.part') or base == 'subs.ass':
        return False
    if source_video(name):
        return False
    if base == 'audio.mp3' and job in source_jobs and job not in video_jobs:
        return False
    if base.endswith('.mp4') and base != 'source.mp4':
        return False
    return True


def plan(archive):
    with tarfile.open(archive, 'r:gz') as src:
        members = src.getmembers()
    video_jobs = set()
    source_jobs = set()
    audio_jobs = set()
    for member in members:
        parts = normalized(member.name).split('/')
        if len(parts) != 3 or parts[0] != 'jobs' or not member.isfile():
            continue
        if parts[2].startswith('source.') and not parts[2].endswith('.part'):
            source_jobs.add(parts[1])
            if source_video(member.name):
                video_jobs.add(parts[1])
        if parts[2] == 'audio.mp3':
            audio_jobs.add(parts[1])
    missing = video_jobs - audio_jobs
    if missing:
        raise RuntimeError(f'{archive.parent.name}: {len(missing)} video job(s) lack extracted audio; keeping the original archive')
    keep = [m for m in members if decide(m.name, video_jobs, source_jobs)]
    dropped = [m for m in members if m not in keep]
    return keep, dropped


class HashingReader:
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, size=-1):
        data = self.source.read(size)
        self.digest.update(data)
        return data


def verify(archive, expected):
    found = {}
    with tarfile.open(archive, 'r:gz') as src:
        for member in src:
            if member.name in found:
                raise RuntimeError(f'duplicate entry in rewritten archive: {member.name}')
            digest = None
            if member.isfile():
                checksum = hashlib.sha256()
                reader = src.extractfile(member)
                for chunk in iter(lambda: reader.read(1024 * 1024), b''):
                    checksum.update(chunk)
                digest = checksum.hexdigest()
            found[member.name] = (member.size, digest)
    if found != expected:
        raise RuntimeError('rewritten archive did not verify against its source')


def repack(archive, keep, original_size):
    fd, temporary = tempfile.mkstemp(prefix='.data-repack-', suffix='.tgz', dir=archive.parent)
    os.close(fd)
    try:
        expected = {}
        with tarfile.open(archive, 'r:gz') as src, tarfile.open(temporary, 'w:gz', compresslevel=1) as dst:
            for member in keep:
                if member.isfile():
                    reader = HashingReader(src.extractfile(member))
                    dst.addfile(member, reader)
                    expected[member.name] = (member.size, reader.digest.hexdigest())
                else:
                    dst.addfile(member)
                    expected[member.name] = (member.size, None)
        verify(temporary, expected)
        if archive.stat().st_size != original_size:
            raise RuntimeError('source archive changed while it was being rewritten')
        os.chmod(temporary, archive.stat().st_mode & 0o777)
        os.replace(temporary, archive)
        return archive.stat().st_size
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='folder containing dated backup directories')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    total_before = total_after = 0
    for archive in sorted(args.directory.glob('????-??-??/data.tgz')):
        before = archive.stat().st_size
        keep, dropped = plan(archive)
        if not dropped:
            print(f'{archive.parent.name}: already compact ({before / 1e6:.1f} MB)')
            total_before += before
            total_after += before
            continue
        kept_bytes = sum(m.size for m in keep if m.isfile())
        dropped_bytes = sum(m.size for m in dropped if m.isfile())
        if args.apply:
            after = repack(archive, keep, before)
            print(f'{archive.parent.name}: {before / 1e6:.1f} → {after / 1e6:.1f} MB; removed {len(dropped)} entries')
        else:
            after = before
            print(f'{archive.parent.name}: {before / 1e6:.1f} MB; keep {kept_bytes / 1e6:.1f} MB, omit {dropped_bytes / 1e6:.1f} MB before compression')
        total_before += before
        total_after += after
    if args.apply:
        print(f'total: {total_before / 1e9:.2f} → {total_after / 1e9:.2f} GB')


if __name__ == '__main__':
    main()
