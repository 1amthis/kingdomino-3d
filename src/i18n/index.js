// The interface's language. English is written in the code itself; each other language maps the
// English text to its own (fr/, de/). t('Round {n}', { n: 3 }) gives the text in the player's
// language, with its {placeholders} filled in; a text missing from a dictionary stays in English.
import fr from './fr/index.js';
import de from './de/index.js';

export const LANGS = { en: 'English', fr: 'Français', de: 'Deutsch' };
const DICTS = { en: {}, fr, de };
// for dates and numbers
const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE' };
const KEY = 'kingdomino3d';

// The player's pick (kept with the other settings), else the browser's first language we speak.
// (Tests run in Node and the search in a worker: neither has storage, and both stay in English.)
function detect() {
  try {
    const picked = JSON.parse(localStorage.getItem(KEY) || '{}').lang;
    if (DICTS[picked]) return picked;
  } catch { /* no storage */ }
  const wanted = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of wanted) {
    const base = String(l || '').slice(0, 2).toLowerCase();
    if (DICTS[base]) return base;
  }
  return 'en';
}

export const lang = detect();
export const locale = LOCALES[lang];

export function t(text, vars) {
  const s = DICTS[lang][text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

// One or other form by the count: t() of one ('{n} point') or other ('{n} points'), with n filled in.
// (French counts 0 as singular.)
export function tn(n, one, other, vars = {}) {
  const single = lang === 'fr' ? Math.abs(n) < 2 : n === 1;
  return t(single ? one : other, { n, ...vars });
}

// A new language takes effect on a fresh page: every text is then drawn in it from the start.
export function setLang(l) {
  if (!DICTS[l] || l === lang) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...saved, lang: l }));
  } catch { /* private mode: stays as it is */ return; }
  location.reload();
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// The page's own texts: each element marked data-i18n has its content (html) translated, and every
// title, aria-label and data-tip that the dictionary knows, and the guide's tab names.
export function translatePage(root = document) {
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  const dict = DICTS[lang];
  // The browser hands innerHTML back with its entities written out (&mdash; as —), so the keys are
  // read the same way before they are compared.
  const parse = document.createElement('template');
  const byHtml = new Map(Object.entries(dict).map(([k, v]) => { parse.innerHTML = k; return [norm(parse.innerHTML), v]; }));
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = byHtml.get(norm(el.innerHTML));
    if (v != null) el.innerHTML = v;
  });
  for (const [attr, sel] of [['title'], ['aria-label'], ['data-tip'], ['data-tab', '.guide-page']]) {
    root.querySelectorAll(`${sel || ''}[${attr}]`).forEach((el) => {
      const v = dict[norm(el.getAttribute(attr))];
      if (v != null) el.setAttribute(attr, v);
    });
  }
  const title = document.querySelector('title');
  if (title && dict[norm(title.textContent)]) document.title = dict[norm(title.textContent)];
}
