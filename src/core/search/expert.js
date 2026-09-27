// The main thread's side of the expert AI: a worker started on first use, asked one position at a time.
// If it cannot start or fails, askExpert() rejects and the caller falls back to the heuristic AI.
const BUDGET = { sims: 3000, ms: 1500 };

let worker = null, seq = 0;
const pending = new Map();

function start() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    pending.delete(data.id);
    if (job) job.resolve(data.move);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    console.warn('[expert]', e.message);
    for (const job of pending.values()) job.reject(e);
    pending.clear();
    worker.terminate();
    worker = null; // the next question starts a fresh one
  };
}

// table: describeTable()'s output. Resolves to a slot index, a { x, y, rot } placement or null (discard).
export function askExpert(table) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) start();
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, table, budget: BUDGET });
    } catch (e) { reject(e); }
  });
}
