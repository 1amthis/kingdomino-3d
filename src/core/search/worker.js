// The expert AI and the coach think here, off the main thread, so the table keeps animating while
// they search. Each runs in a worker of its own; its Search's carried-over tree only matches the
// position it was grown for, so one Search serves every seat.
import { Search } from './mcts.js';
import { gameFrom, moveOut, analysisOut } from './state.js';

const search = new Search();

self.onmessage = ({ data: { id, kind, table, budget } }) => {
  const game = gameFrom(table);
  const result = kind === 'analyse' ? analysisOut(game, search.analyse(game, budget)) : moveOut(game, search.choose(game, budget).move);
  self.postMessage({ id, result });
};
