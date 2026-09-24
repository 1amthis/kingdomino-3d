// Online play over WebRTC (PeerJS). The host's browser runs the real game and relays every decision;
// each guest mirrors it move by move, and a shared seed deals every table the same dominoes.
// The controller only sees two calls: choose(player, kind) for a move made elsewhere, and
// tell(player, kind, value) for a move made here.

export const LEFT = Symbol('left');

const PREFIX = 'kingdomino3d-';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PEER_OPTS = { debug: 1 };
const CONNECT_OPTS = { reliable: true, serialization: 'json' };
const TYPES = ['human', 'easy', 'normal', 'hard'];

// PeerJS only downloads once someone actually opens or joins a table.
const loadPeer = () => import('peerjs').then((m) => m.Peer || m.default);
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || 'Guest';

export const inviteCode = () => {
  const c = new URLSearchParams(location.search).get('join');
  return c && /^[a-z0-9]{4,12}$/.test(c) ? c : null;
};
export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = `?join=${code}`;
  u.hash = '';
  return u.href;
}
export const clearInvite = () => history.replaceState(null, '', location.pathname);
export const isLocalHost = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);

// Opens a PeerJS peer and waits until the signalling server has accepted it.
function openPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, PEER_OPTS) : new Peer(PEER_OPTS);
    const fail = (e) => { peer.destroy(); reject(e); };
    peer.once('error', fail);
    peer.once('open', () => { peer.off('error', fail); resolve(peer); });
  });
}

// A queue that hands each message to whoever waits next; closing it answers every wait with LEFT.
class Mailbox {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(m) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w(m); else this.items.push(m);
  }
  take() {
    if (this.items.length) return Promise.resolve(this.items.shift());
    if (this.closed) return Promise.resolve(LEFT);
    return new Promise((r) => this.waiters.push(r));
  }
  close() { this.closed = true; this.items = []; this.waiters.splice(0).forEach((w) => w(LEFT)); }
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, ...args) { (this.handlers[name] || []).forEach((f) => f(...args)); }
}

// ---------- host ----------
// Events: 'change' (lobby seats changed), 'leave' (seat, name) when a guest drops out.
export class HostSession extends Emitter {
  constructor(config) {
    super();
    this.role = 'host';
    this.config = config; // the menu's choice; friends' seats have type 'remote'
    this.guests = new Map(); // seat index -> { conn, name, box }
    this.started = false;
    this.closed = false;
    this.n = 0;
  }

  async open() {
    const Peer = await loadPeer();
    for (let attempt = 0; ; attempt++) {
      const code = makeCode();
      try {
        this.peer = await openPeer(Peer, PREFIX + code);
        this.code = code;
        break;
      } catch (e) {
        if (e.type !== 'unavailable-id' || attempt >= 3) throw e;
      }
    }
    if (this.closed) { this.peer.destroy(); return null; }
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => { if (!this.closed) this.peer.reconnect(); });
    this.peer.on('error', (e) => console.warn('[online]', e.type, e.message));
    return this.code;
  }

  accept(conn) {
    conn.on('data', (m) => this.receive(conn, m));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  refuse(conn, reason) {
    conn.send({ t: 'refused', reason });
    setTimeout(() => conn.close(), 600);
  }

  seatOf(conn) {
    for (const [i, g] of this.guests) if (g.conn === conn) return i;
    return -1;
  }

  receive(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.seatOf(conn) >= 0) return;
      if (this.started) return this.refuse(conn, 'This game has already started.');
      const seat = this.config.seats.findIndex((s, i) => s.type === 'remote' && !this.guests.has(i));
      if (seat < 0) return this.refuse(conn, 'This game is full.');
      this.guests.set(seat, { conn, name: cleanName(m.name), box: new Mailbox() });
      this.pushLobby();
      this.emit('change');
    } else if (m.t === 'move') {
      const g = this.guests.get(this.seatOf(conn));
      if (g) g.box.push(m);
    } else if (m.t === 'bye') this.drop(conn);
  }

  drop(conn) {
    const seat = this.seatOf(conn);
    if (seat < 0) return;
    const g = this.guests.get(seat);
    this.guests.delete(seat);
    g.box.close();
    conn.close();
    if (this.closed) return;
    this.broadcast({ t: 'left', seat });
    this.pushLobby();
    this.emit('leave', seat, g.name);
    this.emit('change');
  }

  broadcast(msg, except = -1) {
    for (const [i, g] of this.guests) if (i !== except && g.conn.open) g.conn.send(msg);
  }

  // What everyone sees in the waiting room.
  lobbySeats() {
    return this.config.seats.map((s, i) => {
      const g = this.guests.get(i);
      const kind = s.type === 'remote' ? (g ? 'guest' : 'open') : s.type;
      return { name: g ? g.name : s.name, color: s.color, crest: s.crest, kind };
    });
  }

  pushLobby() {
    if (this.started) return;
    const seats = this.lobbySeats();
    for (const [i, g] of this.guests) if (g.conn.open) g.conn.send({ t: 'lobby', seats, you: i });
  }

  get joined() { return this.guests.size; }
  get openSeats() { return this.config.seats.filter((s, i) => s.type === 'remote' && !this.guests.has(i)).length; }

  // Deal a new game: friends who are here play online, empty online seats go to a Knight.
  start() {
    this.started = true;
    this.n = 0;
    const seats = this.config.seats.map((s, i) => {
      if (s.type !== 'remote') return { ...s };
      const g = this.guests.get(i);
      return g ? { ...s, name: g.name, type: 'human', remote: true } : { ...s, type: 'normal' };
    });
    const config = { ...this.config, seats, seed: (Math.random() * 2 ** 32) >>> 0 };
    for (const [i, g] of this.guests) {
      g.box = new Mailbox();
      if (g.conn.open) g.conn.send({ t: 'start', config, you: i });
    }
    return config;
  }

  // A guest's move for their own seat; LEFT if they are gone.
  async choose(p, kind) {
    const g = this.guests.get(p.index);
    if (!g) return LEFT;
    const m = await g.box.take();
    return m !== LEFT && m.kind === kind ? m.value : LEFT;
  }

  // Every decision taken on this table goes out to all guests (except the one who made it).
  tell(p, kind, value) {
    this.broadcast({ t: 'move', n: this.n++, seat: p.index, kind, value }, p.index);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.broadcast({ t: 'closed' });
    for (const g of this.guests.values()) g.box.close();
    // give the goodbye a moment to leave before tearing the connections down
    setTimeout(() => this.peer && this.peer.destroy(), 400);
  }
}

// ---------- guest ----------
// Events: 'lobby' ({seats, you}), 'start' (config), 'refused' (reason), 'left' (seat), 'closed', 'desync'.
export class GuestSession extends Emitter {
  constructor(code) {
    super();
    this.role = 'guest';
    this.code = code;
    this.box = new Mailbox();
    this.closed = false;
    this.n = 0;
    this.you = -1;
  }

  async join(name) {
    const Peer = await loadPeer();
    const peer = this.peer = await openPeer(Peer);
    await new Promise((resolve, reject) => {
      const done = (e) => { clearTimeout(timer); peer.off('error', onError); e ? reject(e) : resolve(); };
      const onError = (e) => done(e.type === 'peer-unavailable' ? new Error('This game could not be found. The host may have closed it.') : e);
      const timer = setTimeout(() => done(new Error('The host did not answer. Check the link and try again.')), 20000);
      peer.on('error', onError);
      this.conn = peer.connect(PREFIX + this.code, CONNECT_OPTS);
      this.conn.once('open', () => done());
    });
    peer.on('error', (e) => console.warn('[online]', e.type, e.message));
    this.conn.on('data', (m) => this.receive(m));
    this.conn.on('close', () => this.lost());
    this.conn.send({ t: 'hello', name: cleanName(name) });
  }

  receive(m) {
    if (!m || typeof m !== 'object' || this.closed) return;
    if (m.t === 'lobby') { this.you = m.you; this.emit('lobby', m); }
    else if (m.t === 'start') { this.box = new Mailbox(); this.n = 0; this.emit('start', this.mirror(m)); }
    else if (m.t === 'move') this.box.push(m);
    else if (m.t === 'left') this.emit('left', m.seat);
    else if (m.t === 'refused') { this.shut(); this.emit('refused', String(m.reason || 'The host refused the connection.')); }
    else if (m.t === 'closed') this.lost();
  }

  // The host's seats as seen from here: ours is played locally, every other one arrives over the wire.
  mirror({ config, you }) {
    this.you = you;
    const seats = config.seats.map((s, i) => ({
      name: cleanName(s.name),
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#999999',
      crest: Math.abs(s.crest | 0) % 4,
      type: i === you ? 'human' : TYPES.includes(s.type) ? s.type : 'normal',
      remote: i !== you,
    }));
    return { seats, seed: config.seed >>> 0, middleKingdom: !!config.middleKingdom, harmony: !!config.harmony, mightyDuel: !!config.mightyDuel };
  }

  // The next move from the host's stream. If the host is gone, the table simply freezes
  // until the player leaves (the 'closed' event tells the UI).
  async choose(p, kind) {
    const n = this.n++;
    const m = await this.box.take();
    if (m === LEFT) return new Promise(() => {});
    if (m.n !== n || m.seat !== p.index || m.kind !== kind) {
      console.error('[online] out of step', m, { n, seat: p.index, kind });
      this.emit('desync');
      return new Promise(() => {});
    }
    return m.value;
  }

  tell(p, kind, value) {
    if (p.index !== this.you || this.closed) return;
    this.n++;
    this.conn.send({ t: 'move', kind, value });
  }

  shut() {
    this.closed = true;
    this.box.close();
    setTimeout(() => this.peer && this.peer.destroy(), 400);
  }

  lost() {
    if (this.closed) return;
    this.shut();
    this.emit('closed');
  }

  close() {
    if (this.closed) return;
    if (this.conn && this.conn.open) this.conn.send({ t: 'bye' });
    this.shut();
  }
}
