// The three directions. Each is a complete token set (both appearances), a type pairing and a default mark.
// Status hues are shared so "green = ready, red = recording, amber = attention" means the same thing everywhere.
export const DIRECTIONS = {
  marquee: {
    key: 'marquee', letter: 'A', name: 'Marquee', primary: 'dark',
    idea: 'The venue. Warm charcoal like a darkened hall, the yellow of a cinema subtitle as the one accent, and a red on-air light in the corner of the mark.',
    best: 'Conference and venue use; a natural evolution of the current dark shell with a colour that is actually ours.',
    tradeoff: 'Dark-first: the light appearance is the second-class citizen, and yellow needs care next to amber warnings.',
    fonts: { ui: '"Instrument Sans"', cjk: '"Noto Sans TC"', display: '"Instrument Serif"', displayStyle: 'italic', displayWeight: 400,
      link: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=Noto+Sans+TC:wght@400;500;700&display=swap' },
    mark: { concept: 'stack', tile: '#131210', top: '#f1ece2', bottom: '#f5c518', dot: '#ff453a' },
    dark: { bg: '#191816', side: '#131210', surface: '#21201d', surface2: '#2b2926', line: '#35322d', lineStrong: '#4a463f',
      fg: '#f1ece2', fg2: '#aca496', fg3: '#7d766c', accent: '#f5c518', accentFg: '#1a1500', accentSoft: 'rgba(245,197,24,.14)', accentText: '#f5c518',
      ok: '#3ec26a', warn: '#ff8f1f', bad: '#ff5a5a', rec: '#ff453a', stage: '#000000' },
    light: { bg: '#f5f2eb', side: '#ede9e0', surface: '#fffdf7', surface2: '#f2eee5', line: '#e0dbcf', lineStrong: '#c4bdae',
      fg: '#1c1a16', fg2: '#6a6458', fg3: '#948d80', accent: '#f5c518', accentFg: '#1a1500', accentSoft: 'rgba(245,197,24,.22)', accentText: '#8f6a00',
      ok: '#1f9a4a', warn: '#c76a00', bad: '#c62828', rec: '#d3232a', stage: '#000000' },
  },
  daylight: {
    key: 'daylight', letter: 'B', name: 'Daylight', primary: 'light',
    idea: 'The page. Warm paper and ink, serif titles, no brand colour at all: colour is reserved for status.',
    best: 'The inclusion ethos made visible: calm, high-contrast, reads like a well-set document at a desk or on a phone.',
    tradeoff: 'Light-first in rooms that are often dark, and the quietest of the three: it relies on typography to carry personality.',
    fonts: { ui: '"IBM Plex Sans"', cjk: '"IBM Plex Sans TC", "Noto Sans TC"', display: 'Newsreader', displayStyle: 'normal', displayWeight: 500, cjkDisplay: '"Noto Serif TC"',
      link: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+TC:wght@400;500;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Noto+Serif+TC:wght@500;700&display=swap' },
    mark: { concept: 'eye', tile: '#1a1815', ink: '#fbf9f4' },
    light: { bg: '#f4f1ea', side: '#ece8de', surface: '#fbf9f4', surface2: '#f1ede4', line: '#dcd6c8', lineStrong: '#b9b2a3',
      fg: '#1a1815', fg2: '#5f5a50', fg3: '#8d8779', accent: '#1a1815', accentFg: '#fbf9f4', accentSoft: 'rgba(26,24,21,.08)', accentText: '#1a1815',
      ok: '#2f7d3a', warn: '#b26200', bad: '#b3261e', rec: '#d3232a', stage: '#000000' },
    dark: { bg: '#1b1a17', side: '#151412', surface: '#23221e', surface2: '#2c2a26', line: '#3a3731', lineStrong: '#57534a',
      fg: '#ece7dc', fg2: '#a49d90', fg3: '#756f64', accent: '#ece7dc', accentFg: '#1b1a17', accentSoft: 'rgba(236,231,220,.1)', accentText: '#ece7dc',
      ok: '#4cbf6a', warn: '#ffa03a', bad: '#ff6b6b', rec: '#ff5252', stage: '#000000' },
  },
  signal: {
    key: 'signal', letter: 'C', name: 'Signal', primary: 'light',
    idea: 'The on-air light. Cool neutrals, a grotesk built for signage, and one coral accent that is also the recording colour.',
    best: 'Work files and the hosted web app as much as the venue: a contemporary product feel, equally at home light or dark.',
    tradeoff: 'The most conventional "modern app" of the three; coral must stay away from error red, so errors always carry an icon and a word.',
    fonts: { ui: 'Archivo', cjk: '"Noto Sans TC"', display: 'Archivo', displayStyle: 'normal', displayWeight: 800,
      link: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap' },
    mark: { concept: 'stack', tile: '#15181d', top: '#ffffff', bottom: '#ffffff', dot: '#ff5a36' },
    light: { bg: '#f1f2f4', side: '#e8eaed', surface: '#ffffff', surface2: '#f4f5f7', line: '#d8dbe0', lineStrong: '#b8bdc6',
      fg: '#15181d', fg2: '#596170', fg3: '#8b93a1', accent: '#ff5a36', accentFg: '#ffffff', accentSoft: 'rgba(255,90,54,.12)', accentText: '#d9401f',
      ok: '#159a48', warn: '#d98a00', bad: '#b5122e', rec: '#ff5a36', stage: '#000000' },
    dark: { bg: '#131518', side: '#0e1013', surface: '#1b1e23', surface2: '#242830', line: '#2f343c', lineStrong: '#454b55',
      fg: '#eef0f3', fg2: '#a2aab5', fg3: '#6e7683', accent: '#ff6b4a', accentFg: '#1a0a06', accentSoft: 'rgba(255,107,74,.16)', accentText: '#ff7a5c',
      ok: '#3ecf72', warn: '#ffab2e', bad: '#ff5c7a', rec: '#ff6b4a', stage: '#000000' },
  },
};

export const SCALE = {
  space: [4, 8, 12, 16, 24, 32],
  radius: { sm: 4, md: 6, lg: 10, xl: 14 },
  type: { hint: 11.5, secondary: 12.5, body: 13, section: 14, title: 20, display: 26 },
  control: { small: 24, default: 28, primary: 32 },
};

export function cssVars(t, fonts) {
  return `--bg:${t.bg};--side:${t.side};--surface:${t.surface};--surface-2:${t.surface2};--line:${t.line};--line-strong:${t.lineStrong};--fg:${t.fg};--fg-2:${t.fg2};--fg-3:${t.fg3};--accent:${t.accent};--accent-fg:${t.accentFg};--accent-soft:${t.accentSoft};--accent-text:${t.accentText};--ok:${t.ok};--warn:${t.warn};--bad:${t.bad};--rec:${t.rec};--stage:${t.stage};--ui:${fonts.ui}, -apple-system, system-ui, ${fonts.cjk}, "PingFang TC", "PingFang SC", sans-serif;--cjk:${fonts.cjk}, "PingFang TC", "PingFang SC", "Noto Sans CJK TC", sans-serif;--display:${fonts.display}, ${fonts.cjkDisplay || fonts.cjk}, serif;--mono:ui-monospace, "SF Mono", Menlo, monospace;`;
}
