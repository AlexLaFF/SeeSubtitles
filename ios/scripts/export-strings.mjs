#!/usr/bin/env node
// web/locales.js → ios/Resources/*.xcstrings. Runs as a build phase in Xcode and by hand: node ios/scripts/export-strings.mjs
import { exportStrings, problems } from './strings.mjs';

const bad = problems().filter((p) => /not in web\/locales\.js/.test(p));
for (const p of bad) console.error(`error: ${p}`); // "error:" is what Xcode shows in its issue list
if (bad.length) process.exit(1);
const r = exportStrings();
console.log(`strings: ${r.keys} for the app, ${r.plist} for Info.plist${r.written.length ? ` — wrote ${r.written.join(', ')}` : ' — unchanged'}`);
