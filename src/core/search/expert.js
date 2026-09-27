// The main thread's side of the expert AI and the coach: a worker each, started on first use and asked
// one position at a time, so a long analysis never holds up an AI's move. If a worker cannot start or
// fails, the promise rejects and the caller carries on without it (the expert then plays like Hard).
const MOVE = { sims: 3000, ms: 1500 };
const ANALYSIS = { sims: 8000, ms: 2500, min: 24 };

function client(kind, budget) {
  let worker = null, seq = 0;
  const pending = new Map();
  const start = () => {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      pending.delete(data.id);
      if (job) job.resolve(data.result);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      console.warn(`[${kind}]`, e.message);
      for (const job of pending.values()) job.reject(e);
      pending.clear();
      worker.terminate();
      worker = null; // the next question starts a fresh one
    };
  };
  return (table) => new Promise((resolve, reject) => {
    try {
      if (!worker) start();
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, kind, table, budget });
    } catch (e) { reject(e); }
  });
}

// table: describeTable()'s output. Resolves to a slot index, a { x, y, rot } placement or null (discard).
export const askExpert = client('move', MOVE);

// Resolves to { player, sims, moves } with every legal move, best first: { move, visits, value, win, ev,
// land } (see Search.analyse; moves and landing spots in the controller's terms).
export const analysePosition = client('analyse', ANALYSIS);
