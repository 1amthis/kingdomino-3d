import * as THREE from 'three';
import { Stage, AMBIENCE } from './gfx/stage.js';
import { createMaterials } from './gfx/materials.js';
import { buildTable } from './gfx/table.js';
import { Effects } from './gfx/effects.js';
import { Sound } from './audio/sound.js';
import { Hud } from './ui/hud.js';
import { HistoryView } from './ui/history.js';
import { GameLog } from './core/history.js';
import { SavedGame } from './core/moves.js';
import { isOver, nextDynasty } from './core/dynasty.js';
import { Controller, ReplayError } from './game/controller.js';
import { t, tn, lang, setLang, translatePage } from './i18n/index.js';
import { HostSession, GuestSession, inviteCode, inviteLink, clearInvite, isLocalHost } from './net/online.js';

const COLORS = ['#e2558f', '#f2c230', '#4fb34f', '#3f7fdb'];
const SEATS = [
  { name: t('You'), type: 'human', color: COLORS[0] },
  { name: t('Lady Aveline'), type: 'normal', color: COLORS[1] },
  { name: t('Sir Godfrey'), type: 'normal', color: COLORS[2] },
  { name: t('Baron Ulric'), type: 'hard', color: COLORS[3] },
];
const DEMO = {
  seats: [
    { name: 'Aveline', type: 'normal', color: COLORS[0], crest: 0 },
    { name: 'Godfrey', type: 'hard', color: COLORS[1], crest: 1 },
    { name: 'Ulric', type: 'normal', color: COLORS[2], crest: 2 },
    { name: 'Mathilde', type: 'hard', color: COLORS[3], crest: 3 },
  ],
  middleKingdom: true, harmony: true, mightyDuel: false,
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const store = {
  get() { try { return JSON.parse(localStorage.getItem('kingdomino3d') || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem('kingdomino3d', JSON.stringify(v)); } catch { /* private mode */ } },
};

async function main() {
  translatePage();
  const hud = new Hud();
  hud.loading(0.04, t('Loading…'));
  try { await Promise.race([document.fonts.load('700 64px Cinzel'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fonts optional */ }

  const stage = new Stage(document.getElementById('app'));
  createMaterials();
  hud.loading(0.1, t('Building the table…'));
  await tick();
  const table = buildTable(stage);
  const fx = new Effects(stage);
  const sound = new Sound();
  const ctl = new Controller(stage, fx, sound, hud);
  stage.onAmbience = (a) => table.candles.forEach((c) => c.setBase(a.candle));
  stage.applyAmbience(stage.ambience);

  await ctl.buildViews((p) => hud.loading(0.15 + p * 0.7, t('Building the dominoes…')));
  hud.loading(0.9, t('Preparing graphics…'));
  // Pre-compile every shader variant so the first draft does not stutter.
  const warm = [...ctl.views.values()].map((v) => v.group);
  warm.forEach((g, i) => { g.position.set((i % 8) * 2.2 - 8, -30, Math.floor(i / 8) * 1.2); stage.scene.add(g); });
  try { await stage.renderer.compileAsync(stage.scene, stage.camera); } catch { stage.renderer.compile(stage.scene, stage.camera); }
  warm.forEach((g) => g.removeFromParent());

  // ---------- settings ----------
  const saved = store.get();
  // Quality follows the device until the player picks one: earlier versions saved the default too.
  if (!saved.qualityPicked) delete saved.quality;
  // phones and tablets run the full effects at 60fps but heat up doing it
  const touch = matchMedia('(pointer: coarse)').matches;
  const settings = Object.assign({ quality: touch ? 'medium' : 'high', speed: '1', camera: 'auto', ambience: 'dusk', tilt: 'on', hints: 'on', coach: 'off', music: true, sfx: true, name: '' }, saved);
  const persist = () => store.set(settings);
  const apply = (key, value) => {
    settings[key] = value;
    hud.setSeg(key, value);
    if (key === 'quality') stage.setQuality(value);
    if (key === 'speed') { ctl.settings.speed = parseFloat(value); if (!ctl.demo) stage.tweener.speed = ctl.settings.speed; }
    if (key === 'camera') { ctl.settings.camera = value; ctl.syncCamera(); }
    if (key === 'ambience') stage.setAmbience(value);
    if (key === 'tilt') stage.setTiltShift(value === 'on');
    if (key === 'hints') { ctl.settings.hints = value === 'on'; ctl.updateHints(); }
    if (key === 'coach') ctl.settings.coach = value;
    persist();
  };
  for (const k of ['quality', 'speed', 'camera', 'tilt', 'hints', 'coach']) apply(k, settings[k]);
  stage.ambience = { ...AMBIENCE[settings.ambience] };
  stage.ambienceName = settings.ambience;
  stage.applyAmbience(stage.ambience);
  hud.setSeg('ambience', settings.ambience);
  hud.setSeg('lang', lang);
  sound.sfxOn = settings.sfx; sound.musicOn = settings.music;
  hud.setToggle('music', settings.music);
  hud.setToggle('sound', settings.sfx);
  hud.on('setting', ({ key, value }) => { if (key === 'lang') { setLang(value); return; } if (key === 'quality') settings.qualityPicked = true; apply(key, value); });

  // ---------- history ----------
  // Every finished game is kept in this browser (localStorage), and what stands out about it shows on
  // the results card, with a way into the history at that game. After the first one, the browser is
  // asked once not to clear that storage when it runs short of space.
  let storage = null; // (a browser that blocks storage throws on the mere access; nothing is kept then)
  try { storage = window.localStorage; } catch { /* blocked */ }
  const log = new GameLog(storage);
  const history = new HistoryView(hud, log);
  // An offline game in progress is saved after every move, so a reload (or a phone closing the tab
  // while it was in the background) picks it up again where it was. It goes once the game ends or is quit.
  const ongoing = new SavedGame(storage);
  ctl.onProgress = (state) => ongoing.save(state);
  let askedToKeep = false;
  ctl.onFinished = (record) => {
    ongoing.clear();
    // A dynasty carries on: until its next game is dealt, a reload deals it.
    if (!session && ctl.dynasty && !isOver(ctl.dynasty)) {
      ongoing.save({ config: { ...lastConfig, dynasty: ctl.dynasty, seed: (Math.random() * 2 ** 32) >>> 0 }, start: null, moves: [], coach: [] });
    }
    const note = history.note(record);
    if (!log.save(record)) { hud.toast(t('This game could not be kept in the history: this browser does not allow it.'), 3.5); return { note }; }
    if (!askedToKeep && navigator.storage && navigator.storage.persist) {
      askedToKeep = true;
      navigator.storage.persisted().then((kept) => kept || navigator.storage.persist()).catch(() => {});
    }
    return { note, review: () => history.openGame(record.id) };
  };
  // the coach's last grades landed after the game was saved
  ctl.onRegraded = (record) => log.save(record);

  document.addEventListener('pointerdown', () => sound.init(), { once: true });
  document.addEventListener('keydown', () => sound.init(), { once: true });

  // ---------- flow between menu, demo and games ----------
  let inMenu = false;
  let lastConfig = null;
  let inGame = false;
  let session = null; // the open online table, as host or guest

  const wideMenu = () => window.innerWidth >= 1100 && window.innerWidth / window.innerHeight > 1.3;
  const orbitDemo = () => {
    stage.controls.autoRotate = true;
    stage.controls.autoRotateSpeed = 0.35;
    stage.flyTo(new THREE.Vector3(0, 21, 31), new THREE.Vector3(0, 0, 0), 2500);
    stage.setViewShift(wideMenu() ? 0.2 : 0, 1600);
  };
  window.addEventListener('resize', () => { if (inMenu) { stage.viewShift = wideMenu() ? 0.2 : 0; stage.applyViewShift(); } });

  async function runDemo() {
    orbitDemo();
    while (inMenu) {
      const done = await ctl.startGame(DEMO, { demo: true });
      if (!done || !inMenu) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  // keepDemo: coming back from the lobby, where the demo never stopped playing.
  function showMenu(keepDemo = false) {
    inMenu = stage.calm = true;
    inGame = false;
    hud.hideHud();
    hud.hideResults();
    if (!keepDemo) runDemo();
    hud.showMenu(SEATS, (config) => {
      sound.init();
      if (config.seats.some((s) => s.type === 'remote')) hostTable(config);
      else startReal(config);
    });
  }

  // resume: a saved game to pick up again (see moves.js)
  async function startReal(config, resume = null) {
    lastConfig = { ...config, seed: undefined }; // playing again deals afresh
    inMenu = stage.calm = false;
    inGame = true;
    stage.controls.autoRotate = false;
    stage.setViewShift(0, 1400);
    hud.hideMenu();
    hud.hideLobby();
    hud.hideResults();
    // (an online guest can be in the history, reviewing the last game, when the host deals the next)
    history.close();
    stage.tweener.speed = ctl.settings.speed;
    await ctl.startGame(config, { link: session, resume });
  }

  // A saved game whose moves no longer replay (a change to the game since) is let go. One without a
  // move yet (a dynasty's next game) is simply dealt from its seed, as if it had just been started.
  async function resumeGame(game) {
    try {
      await startReal(game.config, game.moves.length ? game : null);
    } catch (e) {
      if (!(e instanceof ReplayError)) throw e;
      console.warn('[resume]', e.message);
      ongoing.clear();
      ctl.clearGame();
      showMenu();
      hud.toast(t('Your last game could not be picked up again.'), 3.5);
    }
  }

  // A dynasty deals its next game, and once it is over, a new dynasty.
  ctl.onPlayAgain = () => {
    const dynasty = nextDynasty(ctl.dynasty);
    if (!session) startReal({ ...lastConfig, dynasty });
    else if (session.role === 'host') startReal(session.start(dynasty));
  };
  // (leaving a dynasty between its games: the next one is no longer kept for a reload)
  ctl.onMenu = () => { ongoing.clear(); leaveOnline(); showMenu(); };

  // ---------- online tables ----------
  function leaveOnline() {
    if (session) session.close();
    session = null;
    clearInvite();
    hud.hideLobby();
    hud.hideNotice();
  }
  window.addEventListener('beforeunload', () => { if (session) session.close(); });

  // A friend's chair was left empty mid-game: the AI finishes their kingdom.
  function friendLeft(seat) {
    const p = inGame && ctl.players[seat];
    if (!p || p.type !== 'human' || !p.remote) return;
    if (session && session.role === 'host') p.remote = false;
    p.type = 'normal';
    hud.updateTag(p);
    hud.toast(t('{who} left. The AI plays their kingdom from now on.', { who: hud.who(p) }), 3.5);
  }

  function endOnlineGame(title, text) {
    session = null;
    if (!inGame) {
      hud.setLobby({ sub: text, seats: null, join: null, back: t('Play offline') });
      return;
    }
    hud.setActions(null);
    hud.notice(title, text).then(() => { leaveOnline(); ctl.clearGame(); showMenu(); });
  }

  function hostTable(config) {
    // the menu's default "You" reads oddly on a friend's screen
    config.seats.forEach((st) => { if (st.type === 'human' && hud.isYou(st)) st.name = t('Host'); });
    const s = session = new HostSession(config);
    const refresh = () => {
      if (session !== s || inGame) return;
      const open = s.openSeats, ready = !!s.code;
      hud.setLobby({
        seats: s.lobbySeats(), host: true,
        sub: !ready ? t('Creating the game…')
          : open ? tn(open, 'Waiting for a friend to join…', 'Waiting for {n} friends to join…') : t('Everyone has joined.'),
        begin: { enabled: ready && s.joined > 0, label: open && s.joined ? t('Start · AI fills empty seats') : t('Start game') },
      });
    };
    hud.hideMenu();
    hud.showLobby({
      onBack: () => { leaveOnline(); showMenu(true); },
      onBegin: () => { if (session === s && s.joined) startReal(s.start()); },
    });
    hud.setLobby({ title: t('Online game'), link: null, note: '', join: null, back: t('Back to the menu') });
    refresh();
    s.on('change', refresh);
    s.on('leave', (seat) => friendLeft(seat));
    s.open().then((code) => {
      if (session !== s || !code) return;
      hud.setLobby({
        link: inviteLink(code),
        note: isLocalHost() ? t('This link only works on this computer. Put the game online first (see the README) so friends elsewhere can open it.')
          : t('Anyone with this link can take a free seat in your game.'),
      });
      refresh();
    }).catch((e) => {
      if (session !== s) return;
      console.error(e);
      hud.setLobby({ sub: t('Could not create the online game ({error}). Check your connection and try again.', { error: e.message || e.type }), begin: null });
    });
  }

  function joinTable(code) {
    inMenu = stage.calm = true;
    runDemo();
    hud.showLobby({
      onBack: () => { leaveOnline(); showMenu(true); },
      onJoin: (name) => connect(name),
    });
    hud.setLobby({
      title: t('Online game'), sub: t('You’ve been invited to a game. Enter your name to join.'),
      link: null, note: '', join: { name: settings.name || t('Guest') }, seats: null, begin: null, back: t('Play offline'),
    });

    async function connect(name) {
      sound.init();
      settings.name = name.trim().slice(0, 18);
      persist();
      if (session) session.close();
      const s = session = new GuestSession(code);
      hud.setLobby({ sub: t('Connecting to the host…'), joining: true });
      s.on('lobby', ({ seats, you }) => {
        if (session !== s || inGame) return;
        const host = seats.find((x) => x.kind === 'human');
        hud.setLobby({ join: null, seats, you, sub: host ? t('Waiting for {name} to start…', { name: host.name }) : t('Waiting for the host to start…'), back: t('Leave game') });
      });
      s.on('start', (config) => { if (session === s) startReal(config); });
      s.on('left', (seat) => friendLeft(seat));
      s.on('refused', (reason) => { if (session === s) endOnlineGame(t('Can’t join'), reason); });
      s.on('closed', () => { if (session === s) endOnlineGame(t('The host has left'), t('The host ended the game.')); });
      s.on('desync', () => { if (session === s) { s.close(); endOnlineGame(t('Out of sync'), t('This game no longer matches the host’s. Start a new game.')); } });
      try {
        await s.join(name);
      } catch (e) {
        if (session !== s) return;
        s.close();
        session = null;
        hud.setLobby({ sub: e.message || t('Could not reach the host.'), join: { name }, joining: false });
      }
    }
  }

  const cycleAmbience = () => {
    const order = ['day', 'dusk', 'night'];
    apply('ambience', order[(order.indexOf(settings.ambience) + 1) % order.length]);
    hud.toast(t('Time of day: {label}', { label: AMBIENCE[settings.ambience].label }), 1.6);
  };

  const followPlay = () => {
    if (!inGame) return;
    if (settings.camera !== 'auto') { apply('camera', 'auto'); hud.toast(t('Following the game again'), 1.6); }
    ctl.followPlay();
  };
  const showView = (name) => { if (inGame) ctl.showView(name); };

  hud.on('follow', followPlay);
  hud.on('view-table', () => showView('table'));
  hud.on('view-draft', () => showView('draft'));
  hud.on('view', (i) => showView(i));
  hud.on('ambience', cycleAmbience);
  hud.on('music', () => { settings.music = !settings.music; sound.init(); sound.setMusic(settings.music); hud.setToggle('music', settings.music); persist(); });
  hud.on('sound', () => { settings.sfx = !settings.sfx; sound.init(); sound.setSfx(settings.sfx); hud.setToggle('sound', settings.sfx); persist(); });
  hud.on('settings', () => document.getElementById('settings').classList.remove('hidden'));
  hud.on('help', () => hud.guide.open());
  hud.on('menu', async () => {
    // once the reckoning has begun there is nothing left to lose, so no question
    if (inGame && !ctl.finished) {
      const [title, text, yes] = !session
        ? [t('Quit this game?'), ctl.config.dynasty ? t('This game will be lost, and the dynasty left unfinished.') : t('This game will be lost.'), t('Quit')]
        : session.role === 'host'
          ? [t('End the game for everyone?'), t('All players return to the menu.'), t('End game')]
          : [t('Leave this game?'), t('The AI takes over your kingdom.'), t('Leave')];
      // an offline game holds still while you decide (an online one cannot wait for one player)
      const speed = !session && stage.tweener.speed;
      if (speed) stage.tweener.speed = 0;
      const game = ctl.flow;
      const sure = await hud.ask(title, text, { yes, no: t('Keep playing') });
      if (speed && ctl.flow === game) stage.tweener.speed = speed;
      if (!sure || !inGame || ctl.flow !== game) return;
    }
    if (!session) ongoing.clear();
    leaveOnline();
    ctl.clearGame();
    showMenu();
  });
  hud.on('rotate', () => ctl.rotate(1));
  hud.on('hint', () => { ctl.toggleHints(); apply('hints', ctl.settings.hints ? 'on' : 'off'); });
  hud.on('advice', () => ctl.coach.advise());
  hud.on('discard', () => { const m = ctl.mode; if (m && m.type === 'place' && !m.valid.length) m.resolve(null); });
  ctl.onKey = (k) => {
    if (k === 'c') { if (inGame) ctl.toggleOverview(); }
    else if (k === 'f') followPlay();
    else if (k === 'd') showView('draft');
    else if (k === 'o') showView('table');
    else if (/^[1-4]$/.test(k)) showView(Number(k) - 1);
    else if (k === 't') cycleAmbience();
    else if (k === 'm') hud.emit('music');
    else if (k === 'h') hud.guide.toggle();
    else if (k === 'p') { document.body.classList.toggle('photo'); hud.toast(document.body.classList.contains('photo') ? t('Photo mode &mdash; press P to bring the interface back') : t('Interface restored'), 1.6); }
    else if (k === 'escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  };

  stage.start();
  hud.loading(1, t('Ready'));
  await new Promise((r) => setTimeout(r, 300));
  hud.hideLoading();
  const invite = inviteCode();
  const unfinished = !invite && ongoing.load();
  if (invite) joinTable(invite);
  else if (unfinished) resumeGame(unfinished);
  else showMenu();

  // ---------- offline ----------
  // The service worker (src/sw.js, built only for production) keeps the whole game in the browser's cache.
  // A newer build waits until the page is in the background with no online table open, then takes over
  // and the page reloads into it: an offline game is saved after every move, so it picks up where it was.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      const update = () => { if (reg.waiting && document.hidden && !session) reg.waiting.postMessage('update'); };
      document.addEventListener('visibilitychange', update);
      reg.addEventListener('updatefound', () => reg.installing.addEventListener('statechange', update));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((e) => console.warn('[offline]', e.message));
    // (the first install also takes over the page, which needs nothing new for it)
    let controlled = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) controlled = true;
      else if (!reloading) { reloading = true; location.reload(); }
    });
  }

  // expose for debugging in the console
  window.kingdomino = { stage, ctl, hud, sound, fx };
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading-text');
  if (el) el.textContent = `${t('Something went wrong:')} ${e.message}`;
});
