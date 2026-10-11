// The table's look. Classic all year; through October, and on the night after Halloween, the table
// dresses up for Halloween. A player's own pick holds for the season it was made in: choosing Classic
// in October keeps Halloween away until next October, choosing Halloween in spring lasts until the
// pumpkins come out anyway. Like the language, a new skin takes effect on a fresh page: every diorama
// is carved once, as the page loads.
export const SKINS = ['classic', 'halloween'];
const KEY = 'kingdomino3d';

// The season a day belongs to, named so that each season has a name of its own: 'halloween-2026' from
// 1 October to 1 November 2026, then 'classic-2027' until the next October.
export function season(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth();
  if (m === 9 || (m === 10 && date.getDate() === 1)) return `halloween-${y}`;
  return `classic-${m >= 10 ? y + 1 : y}`;
}

// The skin a season wears when nobody picked one.
export const seasonal = (date = new Date()) => season(date).split('-')[0];

// The skin for this page: the pick saved with the settings, if it was made this season.
// (Tests run in Node and the search in a worker: neither has storage, and both keep the season's.)
export function pick(saved, date = new Date()) {
  if (saved && SKINS.includes(saved.skin) && saved.skinSeason === season(date)) return saved.skin;
  return seasonal(date);
}

function detect() {
  try { return pick(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return seasonal(); }
}

export const skin = detect();
export const halloween = skin === 'halloween';

// (the page's colours follow: see the end of style.css)
if (typeof document !== 'undefined') {
  document.documentElement.dataset.skin = skin;
  if (halloween) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#150c1d');
}

export function setSkin(name) {
  if (!SKINS.includes(name) || name === skin) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...saved, skin: name, skinSeason: season() }));
  } catch { /* private mode: stays as it is */ return; }
  location.reload();
}
