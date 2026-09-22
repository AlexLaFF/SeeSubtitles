'use strict';
// Version numbers as the app and the server compare them: the desktop's updater (desktop/lib/updater.js) against
// what the server publishes (server/lib/updates.js). Pure.

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

module.exports = { compareVersions };
