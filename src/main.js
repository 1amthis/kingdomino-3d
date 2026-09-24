import * as THREE from 'three';
import { Stage, AMBIENCE } from './gfx/stage.js';
import { createMaterials } from './gfx/materials.js';
import { buildTable } from './gfx/table.js';
import { Effects } from './gfx/effects.js';
import { Sound } from './audio/sound.js';
import { Hud } from './ui/hud.js';
import { Controller } from './game/controller.js';
import { HostSession, GuestSession, inviteCode, inviteLink, clearInvite, isLocalHost } from './net/online.js';

const COLORS = ['#e2558f', '#f2c230', '#4fb34f', '#3f7fdb'];
const SEATS = [
  { name: 'You', type: 'human', color: COLORS[0] },
  { name: 'Lady Aveline', type: 'normal', color: COLORS[1] },
  { name: 'Sir Godfrey', type: 'normal', color: COLORS[2] },
  { name: 'Baron Ulric', type: 'hard', color: COLORS[3] },
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
  const hud = new Hud();
  hud.loading(0.04, 'Loading…');
  try { await Promise.race([document.fonts.load('700 64px Cinzel'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fonts optional */ }

  const stage = new Stage(document.getElementById('app'));
  createMaterials();
  hud.loading(0.1, 'Building the table…');
  await tick();
  const table = buildTable(stage);
  const fx = new Effects(stage);
  const sound = new Sound();
  const ctl = new Controller(stage, fx, sound, hud);
  stage.onAmbience = (a) => table.candles.forEach((c) => c.setBase(a.candle));
  stage.applyAmbience(stage.ambience);

  await ctl.buildViews((p) => hud.loading(0.15 + p * 0.7, 'Building the dominoes…'));
  hud.loading(0.9, 'Preparing graphics…');
  // Pre-compile every shader variant so the first draft does not stutter.
  const warm = [...ctl.views.values()].map((v) => v.group);
  warm.forEach((g, i) => { g.position.set((i % 8) * 2.2 - 8, -30, Math.floor(i / 8) * 1.2); stage.scene.add(g); });
  try { await stage.renderer.compileAsync(stage.scene, stage.camera); } catch { stage.renderer.compile(stage.scene, stage.camera); }
  warm.forEach((g) => g.removeFromParent());

  // ---------- settings ----------
  const saved = store.get();
  const settings = Object.assign({ quality: 'high', speed: '1', camera: 'auto', ambience: 'dusk', tilt: 'on', hints: 'on', music: true, sfx: true, name: '' }, saved);
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
    persist();
  };
  for (const k of ['quality', 'speed', 'camera', 'tilt', 'hints']) apply(k, settings[k]);
  stage.ambience = { ...AMBIENCE[settings.ambience] };
  stage.ambienceName = settings.ambience;
  stage.applyAmbience(stage.ambience);
  hud.setSeg('ambience', settings.ambience);
  sound.sfxOn = settings.sfx; sound.musicOn = settings.music;
  hud.setToggle('music', settings.music);
  hud.setToggle('sound', settings.sfx);
  hud.on('setting', ({ key, value }) => apply(key, value));

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
    inMenu = true;
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

  async function startReal(config) {
    lastConfig = config;
    inMenu = false;
    inGame = true;
    stage.controls.autoRotate = false;
    stage.setViewShift(0, 1400);
    hud.hideMenu();
    hud.hideLobby();
    hud.hideResults();
    stage.tweener.speed = ctl.settings.speed;
    await ctl.startGame(config, { link: session });
  }

  ctl.onPlayAgain = () => {
    if (!session) startReal(lastConfig);
    else if (session.role === 'host') startReal(session.start());
  };
  ctl.onMenu = () => { leaveOnline(); showMenu(); };

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
    hud.toast(`${hud.who(p)} left. The AI plays their kingdom from now on.`, 3.5);
  }

  function endOnlineGame(title, text) {
    session = null;
    if (!inGame) {
      hud.setLobby({ sub: text, seats: null, join: null, back: 'Play offline' });
      return;
    }
    hud.setActions(null);
    hud.notice(title, text).then(() => { leaveOnline(); ctl.clearGame(); showMenu(); });
  }

  function hostTable(config) {
    // the menu's default "You" reads oddly on a friend's screen
    config.seats.forEach((st) => { if (st.type === 'human' && st.name === 'You') st.name = 'Host'; });
    const s = session = new HostSession(config);
    const refresh = () => {
      if (session !== s || inGame) return;
      const open = s.openSeats, ready = !!s.code;
      hud.setLobby({
        seats: s.lobbySeats(), host: true,
        sub: !ready ? 'Creating the game…'
          : open ? `Waiting for ${open === 1 ? 'a friend' : `${open} friends`} to join…` : 'Everyone has joined.',
        begin: { enabled: ready && s.joined > 0, label: open && s.joined ? 'Start · AI fills empty seats' : 'Start game' },
      });
    };
    hud.hideMenu();
    hud.showLobby({
      onBack: () => { leaveOnline(); showMenu(true); },
      onBegin: () => { if (session === s && s.joined) startReal(s.start()); },
    });
    hud.setLobby({ title: 'Online game', link: null, note: '', join: null, back: 'Back to the menu' });
    refresh();
    s.on('change', refresh);
    s.on('leave', (seat) => friendLeft(seat));
    s.open().then((code) => {
      if (session !== s || !code) return;
      hud.setLobby({
        link: inviteLink(code),
        note: isLocalHost() ? 'This link only works on this computer. Put the game online first (see the README) so friends elsewhere can open it.'
          : 'Anyone with this link can take a free seat in your game.',
      });
      refresh();
    }).catch((e) => {
      if (session !== s) return;
      console.error(e);
      hud.setLobby({ sub: `Could not create the online game (${e.message || e.type}). Check your connection and try again.`, begin: null });
    });
  }

  function joinTable(code) {
    inMenu = true;
    runDemo();
    hud.showLobby({
      onBack: () => { leaveOnline(); showMenu(true); },
      onJoin: (name) => connect(name),
    });
    hud.setLobby({
      title: 'Online game', sub: 'You’ve been invited to a game. Enter your name to join.',
      link: null, note: '', join: { name: settings.name || 'Guest' }, seats: null, begin: null, back: 'Play offline',
    });

    async function connect(name) {
      sound.init();
      settings.name = name.trim().slice(0, 18);
      persist();
      if (session) session.close();
      const s = session = new GuestSession(code);
      hud.setLobby({ sub: 'Connecting to the host…', joining: true });
      s.on('lobby', ({ seats, you }) => {
        if (session !== s || inGame) return;
        const host = seats.find((x) => x.kind === 'human');
        hud.setLobby({ join: null, seats, you, sub: `Waiting for ${host ? host.name : 'the host'} to start…`, back: 'Leave game' });
      });
      s.on('start', (config) => { if (session === s) startReal(config); });
      s.on('left', (seat) => friendLeft(seat));
      s.on('refused', (reason) => { if (session === s) endOnlineGame('Can’t join', reason); });
      s.on('closed', () => { if (session === s) endOnlineGame('The host has left', 'The host ended the game.'); });
      s.on('desync', () => { if (session === s) { s.close(); endOnlineGame('Out of sync', 'This game no longer matches the host’s. Start a new game.'); } });
      try {
        await s.join(name);
      } catch (e) {
        if (session !== s) return;
        s.close();
        session = null;
        hud.setLobby({ sub: e.message || 'Could not reach the host.', join: { name }, joining: false });
      }
    }
  }

  const cycleAmbience = () => {
    const order = ['day', 'dusk', 'night'];
    apply('ambience', order[(order.indexOf(settings.ambience) + 1) % order.length]);
    hud.toast(`Time of day: ${AMBIENCE[settings.ambience].label}`, 1.6);
  };

  const followPlay = () => {
    if (!inGame) return;
    if (settings.camera !== 'auto') { apply('camera', 'auto'); hud.toast('Following the game again', 1.6); }
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
  hud.on('help', () => document.getElementById('help').classList.remove('hidden'));
  hud.on('menu', async () => {
    // once the reckoning has begun there is nothing left to lose, so no question
    if (inGame && !ctl.finished) {
      const [title, text, yes] = !session
        ? ['Quit this game?', 'This game will be lost.', 'Quit']
        : session.role === 'host'
          ? ['End the game for everyone?', 'All players return to the menu.', 'End game']
          : ['Leave this game?', 'The AI takes over your kingdom.', 'Leave'];
      // an offline game holds still while you decide (an online one cannot wait for one player)
      const speed = !session && stage.tweener.speed;
      if (speed) stage.tweener.speed = 0;
      const game = ctl.flow;
      const sure = await hud.ask(title, text, { yes, no: 'Keep playing' });
      if (speed && ctl.flow === game) stage.tweener.speed = speed;
      if (!sure || !inGame || ctl.flow !== game) return;
    }
    leaveOnline();
    ctl.clearGame();
    showMenu();
  });
  hud.on('rotate', () => ctl.rotate(1));
  hud.on('hint', () => { ctl.toggleHints(); apply('hints', ctl.settings.hints ? 'on' : 'off'); });
  hud.on('discard', () => { const m = ctl.mode; if (m && m.type === 'place' && !m.valid.length) m.resolve(null); });
  ctl.onKey = (k) => {
    if (k === 'c') { if (inGame) ctl.toggleOverview(); }
    else if (k === 'f') followPlay();
    else if (k === 'd') showView('draft');
    else if (k === 'o') showView('table');
    else if (/^[1-4]$/.test(k)) showView(Number(k) - 1);
    else if (k === 't') cycleAmbience();
    else if (k === 'm') hud.emit('music');
    else if (k === 'h') document.getElementById('help').classList.toggle('hidden');
    else if (k === 'p') { document.body.classList.toggle('photo'); hud.toast(document.body.classList.contains('photo') ? 'Photo mode &mdash; press P to bring the interface back' : 'Interface restored', 1.6); }
    else if (k === 'escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  };

  stage.start();
  hud.loading(1, 'Ready');
  await new Promise((r) => setTimeout(r, 300));
  hud.hideLoading();
  const invite = inviteCode();
  if (invite) joinTable(invite);
  else showMenu();

  // expose for debugging in the console
  window.kingdomino = { stage, ctl, hud, sound, fx };
}

main().catch((e) => {
  console.error(e);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = 'Something went wrong: ' + e.message;
});
