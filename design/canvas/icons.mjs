// Icon concepts for See Subtitles, drawn in an 824×824 tile space (macOS app icons are 1024 with a 100px
// transparent margin; UI renders the bare tile). Every mark is bottom-weighted: the empty upper half is the
// screen, the bars are the subtitles at its foot.
const R = 185; // ≈ 22.5 % corner radius (macOS squircle approximation)

function tile(fill, inner, { margin = false, size } = {}) {
  const vb = margin ? '0 0 1024 1024' : '0 0 824 824';
  const g = margin ? `<g transform="translate(100 100)">` : '<g>';
  const attrs = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${attrs}>${g}<rect width="824" height="824" rx="${R}" fill="${fill}"/>${inner}</g></svg>`;
}

/** Stack: the bilingual pair — a long bright line (translation) over a shorter, quieter line (original). */
export function stack({ tile: t = '#131210', top = '#f1ece2', bottom = '#f5c518', bottomOpacity = 1, dot = null, margin, size } = {}) {
  let inner = `<rect x="150" y="452" width="524" height="96" rx="48" fill="${top}"/><rect x="232" y="596" width="360" height="72" rx="36" fill="${bottom}"${bottomOpacity < 1 ? ` opacity="${bottomOpacity}"` : ''}/>`;
  if (dot) inner = `<circle cx="196" cy="196" r="46" fill="${dot}"/>` + inner;
  return tile(t, inner, { margin, size });
}

/** Eye-line: an upper lid and pupil over a subtitle bar — "see" made literal, the bar as the lower lid. */
export function eye({ tile: t = '#1a1815', ink = '#fbf9f4', bar = null, margin, size } = {}) {
  const inner = `<path d="M150 470 Q412 150 674 470" fill="none" stroke="${ink}" stroke-width="84" stroke-linecap="round"/><circle cx="412" cy="440" r="66" fill="${ink}"/><rect x="150" y="548" width="524" height="80" rx="40" fill="${bar || ink}"/>`;
  return tile(t, inner, { margin, size });
}

/** Bracket: the CJK corner quote 「 framing a subtitle line — text on screen, in the typography of Cantonese. */
export function bracket({ tile: t = '#1a1815', ink = '#fbf9f4', bar = null, margin, size } = {}) {
  const inner = `<path d="M150 420 V190 H380 M674 404 V634 H444" fill="none" stroke="${ink}" stroke-width="76" stroke-linejoin="miter"/><rect x="236" y="372" width="352" height="80" rx="40" fill="${bar || ink}"/><rect x="296" y="496" width="232" height="60" rx="30" fill="${bar || ink}" opacity="0.72"/>`;
  return tile(t, inner, { margin, size });
}

/** Menu-bar template icon (22 pt canvas, 16 pt mark). macOS tints template images itself, so only alpha matters. */
export function tray({ color = '#000', size = 22, concept = 'stack' } = {}) {
  const marks = {
    stack: `<rect x="3" y="9.5" width="16" height="3.4" rx="1.7" fill="${color}"/><rect x="5.5" y="14.5" width="11" height="2.6" rx="1.3" fill="${color}"/>`,
    eye: `<path d="M4 11.5 Q11 3.5 18 11.5" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="11" cy="10.6" r="1.8" fill="${color}"/><rect x="4" y="14" width="14" height="2.6" rx="1.3" fill="${color}"/>`,
    bracket: `<path d="M4 10.5 V4.5 H10 M18 11.5 V17.5 H12" fill="none" stroke="${color}" stroke-width="2"/><rect x="6.5" y="9.5" width="9" height="2.4" rx="1.2" fill="${color}"/><rect x="8" y="13" width="6" height="1.8" rx="0.9" fill="${color}" opacity="0.7"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22" width="${size}" height="${size}">${marks[concept]}</svg>`;
}

export const CONCEPTS = { stack, eye, bracket };
