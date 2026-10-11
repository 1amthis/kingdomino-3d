// Raw observation for neural MCTS: two kingdoms (terrain and crowns per playable
// square), all visible dominoes, legal-slot mask, stage and scoring options.
// No manually engineered terrain synergies, heuristic scores or chosen actions.
// Representation is deliberately stable and shared by data generation / inference.
import { DOM, INIT, PLACE } from './engine.js';
export const BOARD_WIDTH = 9;
export const NEURAL_INPUT = 2 * 9 * 9 * 2 + 4 * 5 + 4 + 7;
export function encodeDraft(game, out = new Float32Array(NEURAL_INPUT)) {
  if (game.n !== 2 || game.boards[0].g.size !== 5 || game.phase === PLACE)
    throw Error('Neural draft policy supports 2-player 5x5 draft states only');
  out.fill(0);
  let p=0;
  const player=game.player;
  for(const b of [game.boards[player], game.boards[1-player]]) {
    const W=b.g.W;
    for(let y=1;y<=9;y++)for(let x=1;x<=9;x++){
      const i=y*W+x;
      out[p++]=b.t[i]/8;
      out[p++]=b.c[i]/3;
    }
  }
  const line=game.phase===INIT?game.line:game.nextLine;
  const own=game.phase===INIT?game.own:game.nextOwn;
  for(let i=0;i<4;i++) {
    const d=line[i],j=4*d;
    out[p++]=DOM[j]/7;out[p++]=DOM[j+1]/3;
    out[p++]=DOM[j+2]/7;out[p++]=DOM[j+3]/3;
    out[p++]=d/47;
  }
  for(let i=0;i<4;i++)out[p++]=own[i]<0?1:0;
  out[p++]=game.phase===INIT?1:0;
  out[p++]=game.boards[player].placed/12;
  out[p++]=game.boards[1-player].placed/12;
  out[p++]=game.left/24;
  out[p++]=game.middle?1:0;
  out[p++]=game.harmony?1:0;
  out[p++]=player;
  if(p!==NEURAL_INPUT)throw Error('Neural feature mismatch '+p);
  return out;
}
