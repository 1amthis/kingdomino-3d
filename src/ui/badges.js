// A badge for each achievement: its own picture on a medal in its group's metal (gold for victories,
// emerald for kingdoms, sapphire for the coach's mastery, bronze for the long road). A badge not yet
// earned shows its picture faintly, so each one says what it is for before it is won.
import { TERRAIN_INFO } from '../core/rules.js';

// Drawn on a 24×24 grid in the medal's ink (currentColor); `cut` parts take the medal's own colour,
// as if carved into the picture.
const CUT = 'class="cut"';
const star = (cx, cy, r) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * 0.45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`;
  });
  return `<polygon points="${pts.join(' ')}"/>`;
};
const sword = (angle) => `<g transform="rotate(${angle} 12 12)"><path d="M11.1 1.5h1.8l.6 13.5h-3z"/><rect x="7.6" y="15" width="8.8" height="1.9" rx=".9"/><rect x="11.1" y="16.9" width="1.8" height="3.6"/><circle cx="12" cy="21.6" r="1.3"/></g>`;
const shield = (x, y) => `<path transform="translate(${x} ${y})" d="M0 0h9v5c0 3-2.2 4.6-4.5 5.5C2.2 9.6 0 8 0 5z"/>`;
const CASTLE = '<path d="M3 22V9h3v3h3V9h6v3h3V9h3v13h-7v-4.5a2 2 0 0 0-4 0V22z"/><rect x="11.4" y="1.5" width="1.2" height="7.5"/><path d="M12.6 1.5l4.4 1.8-4.4 1.8z"/>';
// a kingdom as an n×n grid of squares; centre: its middle given over to a castle
const grid = (n, centre) => {
  let out = '';
  const step = 20.5 / n, size = step * 0.85;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (centre && x > 0 && x < n - 1 && y > 0 && y < n - 1) continue;
    out += `<rect x="${(2 + x * step).toFixed(2)}" y="${(2 + y * step).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${(size / 5).toFixed(2)}"/>`;
  }
  return centre ? `${out}<g transform="translate(12 12) scale(.5) translate(-12 -11.8)">${CASTLE}</g>` : out;
};
// a pointy-top hexagon cut into six, one slice per terrain in its colour
const hexagon = () => ['wheat', 'forest', 'lake', 'grass', 'swamp', 'mine'].map((terrain, i) => {
  const at = (k) => { const a = -Math.PI / 2 + (k * Math.PI) / 3; return `${(12 + 10.5 * Math.cos(a)).toFixed(2)},${(12 + 10.5 * Math.sin(a)).toFixed(2)}`; };
  return `<polygon points="12,12 ${at(i)} ${at(i + 1)}" fill="${TERRAIN_INFO[terrain].color}" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/>`;
}).join('');
const checkered = () => {
  let out = '<rect x="6.6" y="3" width="14" height="10" fill="none" stroke="currentColor" stroke-width="1"/>';
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) out += `<rect x="${6.6 + x * 3.5}" y="${3 + y * 3.33}" width="3.5" height="3.34"/>`;
  return `<rect x="4" y="2" width="1.8" height="20" rx=".9"/>${out}`;
};
const sun = () => `<circle cx="12" cy="12" r="5"/>${Array.from({ length: 8 }, (_, i) => `<rect x="11.1" y="1" width="1.8" height="4.2" rx=".9" transform="rotate(${i * 45} 12 12)"/>`).join('')}`;
const wheat = () => {
  let out = '<rect x="11.3" y="7" width="1.4" height="15" rx=".7"/><ellipse cx="12" cy="4.6" rx="1.6" ry="2.8"/>';
  for (const [y, side] of [[9, -1], [9, 1], [13, -1], [13, 1], [17, -1], [17, 1]]) out += `<ellipse cx="${12 + side * 2.4}" cy="${y}" rx="1.5" ry="2.7" transform="rotate(${side * 35} ${12 + side * 2.4} ${y})"/>`;
  return out;
};

const PICTURES = {
  'first-win': '<path d="M3 17.5V7.5l4.5 4L12 4.5l4.5 7 4.5-4v10z"/><rect x="3" y="19" width="18" height="2.4" rx="1.2"/>',
  'beat-expert': `<g transform="translate(12 12) scale(1.22) translate(-12 -12)">${sword(45)}</g>`,
  'all-levels': '<rect x="5.5" y="2" width="2" height="20" rx="1"/><rect x="16.5" y="2" width="2" height="20" rx="1"/><path d="M7.5 4.5h9v2h-9zM7.5 9.5h9v2h-9zM7.5 14.5h9v2h-9zM7.5 19.5h9v2h-9z"/>',
  'four-players': shield(2, 1.5) + shield(13, 1.5) + shield(2, 12.5) + shield(13, 12.5),
  duel: sword(45) + sword(-45),
  dynasty: CASTLE,
  'hat-trick': star(5, 14, 4.2) + star(12, 9, 4.6) + star(19, 14, 4.2),
  'photo-finish': checkered(),
  'among-friends': '<g opacity=".65"><circle cx="16" cy="7.5" r="3.4"/><path d="M9.5 21c0-4.4 2.9-7.6 6.5-7.6s6.5 3.2 6.5 7.6z"/></g><circle cx="8.5" cy="8" r="3.6"/><path d="M1.5 21.5c0-4.6 3.1-8 7-8s7 3.4 7 8z"/>',
  'score-70': wheat(),
  'score-80': sun(),
  jewel: `<path d="M7 3h10l4.5 6L12 21.5 2.5 9z"/><path ${CUT} d="M2.5 9h19M9.5 3 7.6 9 12 21.5 16.4 9 14.5 3" fill="none" stroke-width="1" stroke-linejoin="round"/>`,
  'crowns-13': `<path d="M8 7V3.5l2 1.6L12 2.5l2 2.6 2-1.6V7z"/><path d="M3 12v-2c0-1.9 1.6-3 3.5-3h11c1.9 0 3.5 1.1 3.5 3v2z"/><rect x="3" y="13" width="18" height="8.5" rx="1.2"/><rect ${CUT} x="10.5" y="11" width="3" height="4" rx=".6"/>`,
  vast: '<path d="M1 21l7.5-12 4 6.2 3-4.4L23 21z"/><circle cx="18" cy="5.5" r="2.5"/>',
  'six-terrains': hexagon(),
  full: grid(7, false),
  flawless: grid(5, true),
  steady: `<path d="M12 1.5l8.5 3.2v6.1c0 5.3-3.6 9.4-8.5 11.7-4.9-2.3-8.5-6.4-8.5-11.7V4.7z"/><path ${CUT} d="M7.6 12l3.2 3.2 5.6-6.4" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  sharp: `<path d="M1 12c3-5.5 7-8 11-8s8 2.5 11 8c-3 5.5-7 8-11 8S4 17.5 1 12z"/><circle ${CUT} cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="2.2"/>`,
  student: `<path d="M12 6C9.5 4.3 6 4 2 4.5V19c4-.5 7.5-.2 10 1.5 2.5-1.7 6-2 10-1.5V4.5C18 4 14.5 4.3 12 6z"/><path ${CUT} d="M12 6v14.5" fill="none" stroke-width="1"/>`,
  'games-10': `<rect x="6.5" y="1.5" width="11" height="21" rx="2"/><path ${CUT} d="M8.2 12h7.6" fill="none" stroke-width="1.1"/><circle ${CUT} cx="12" cy="6.8" r="1.5"/><circle ${CUT} cx="9.6" cy="15" r="1.3"/><circle ${CUT} cx="14.4" cy="19.2" r="1.3"/>`,
  'games-50': '<path d="M6 2.5h12v4.5a6 6 0 0 1-5 5.9V18h3.5v3.5h-9V18H11v-5.1A6 6 0 0 1 6 7z"/>',
  'games-100': '<rect x="3.5" y="2" width="17" height="2.6" rx=".6"/><rect x="5.5" y="5.3" width="13" height="1.6"/><path d="M7 7.6h1.9v10.3H7zM10.3 7.6h1.9v10.3h-1.9zM13.6 7.6h1.9v10.3h-1.9zM16.1 7.6H18v10.3h-1.9z"/><rect x="5.5" y="18.6" width="13" height="1.6"/><rect x="3.5" y="20.8" width="17" height="1.8" rx=".6"/>',
  'wins-25': '<rect x="4.5" y="1.5" width="1.8" height="21" rx=".9"/><path d="M6.3 3H20.5l-3.4 4.6 3.4 4.6H6.3z"/>',
};

export const hasBadge = (id) => id in PICTURES;

// A badge as html. a: an achievement (core/achievements.js); small: the size for the results card.
// Ones that take several games carry the count they ask for.
export function badge(a, { small = false } = {}) {
  const count = a.need > 1 ? `<span class="badge-n">${a.need}</span>` : '';
  return `<span class="badge m-${a.group}${a.done ? ' won' : ''}${small ? ' small' : ''}" aria-hidden="true">
    <svg viewBox="0 0 24 24">${PICTURES[a.id] || PICTURES['first-win']}</svg>${small ? '' : count}</span>`;
}
