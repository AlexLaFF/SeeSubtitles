#!/usr/bin/env node
// Fails when the Swift code names a string the catalogue lacks, or the catalogue keeps an ios.* string nothing
// uses. The iOS half of desktop/test/i18n.test.js, which checks both languages carry every string.
import { problems, usedKeys } from './strings.mjs';

const all = problems();
for (const p of all) console.error(`error: ${p}`);
if (all.length) process.exit(1);
console.log(`strings: ${usedKeys().size} keys used by Swift, all in web/locales.js`);
