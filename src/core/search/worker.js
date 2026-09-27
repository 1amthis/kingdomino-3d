// The expert AI thinks here, off the main thread, so the table keeps animating while it searches.
// One Search serves every expert seat: its carried-over tree only matches the position it was grown for.
import { Search } from './mcts.js';
import { gameFrom, moveOut } from './state.js';

const search = new Search();

self.onmessage = ({ data: { id, table, budget } }) => {
  const game = gameFrom(table);
  const { move } = search.choose(game, budget);
  self.postMessage({ id, move: moveOut(game, move) });
};
