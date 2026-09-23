'use strict';
// Run after stapling: the ticket changes the DMG, invalidating builder's blockmap and YAML hash.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function sha512(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}

async function main(dmg, manifest = path.join(path.dirname(dmg), 'latest-mac.yml')) {
  if (!dmg || !fs.existsSync(dmg)) throw new Error('Existing DMG path required');
  await buildBlockMap(dmg, 'gzip', `${dmg}.blockmap`);
  const dir = path.dirname(manifest);
  const lines = fs.readFileSync(manifest, 'utf8').split('\n');
  const files = new Map();
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^  - url: (.+)$/.exec(lines[i]);
    if (!match) continue;
    const name = match[1].trim();
    if (path.basename(name) !== name) throw new Error(`Unexpected release filename: ${name}`);
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`Missing release file: ${file}`);
    if (!/^    sha512: /.test(lines[i + 1]) || !/^    size: /.test(lines[i + 2])) {
      throw new Error(`Unexpected manifest layout for ${name}`);
    }
    const hash = await sha512(file);
    lines[i + 1] = `    sha512: ${hash}`;
    lines[i + 2] = `    size: ${fs.statSync(file).size}`;
    files.set(name, hash);
    count++;
  }
  if (!count || !files.has(path.basename(dmg))) throw new Error('DMG absent from update manifest');
  const primary = lines.find((line) => line.startsWith('path: '))?.slice(6).trim();
  if (!primary || !files.has(primary)) throw new Error('Primary update file absent from manifest');
  const topHashIndex = lines.findIndex((line) => line.startsWith('sha512: '));
  if (topHashIndex < 0) throw new Error('Primary SHA-512 absent from manifest');
  lines[topHashIndex] = `sha512: ${files.get(primary)}`;
  const tmp = `${manifest}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n'));
  fs.renameSync(tmp, manifest);
  console.log(`· refreshed ${path.basename(dmg)} blockmap and ${path.basename(manifest)} checksums`);
}

if (require.main === module) main(process.argv[2], process.argv[3]).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

module.exports = { main };
