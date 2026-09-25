const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('public language lists match the live and file choices', () => {
  execFileSync(process.execPath, [path.join(__dirname, '../../web/generate-site-languages.js'), '--check']);
});
