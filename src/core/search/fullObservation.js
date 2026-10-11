// Complete observable input for a shared draft + placement + outcome model.
// Spatial tensor: 20 channels (9 terrain one-hot + 1 crown) for each player, 9x9.
// Global vector: current/next domino lines, ownership, stage/rules, seen tile flags.
// These encodings never inspect the hidden deck or future determinized tiles.
import { DOM, INIT, PLACE, PICK, DISCARD } from './engine.js';
export const FULL_SIZE=9, FULL_SPATIAL_CHANNELS=24, FULL_AUX=106;
export const FULL_PLACE_ACTIONS=324, FULL_DISCARD_ACTION=324;

export function moveIndex(game,move) {
  if(game.phase!==PLACE) {
    if(!Number.isInteger(move)||move<0||move>=4)throw Error('Invalid draft slot '+move);
    return move;
  }
  if(move===DISCARD)return FULL_DISCARD_ACTION;
  const b=game.boards[game.player],W=b.g.W,a=move>>8,z=move&255;
  const col=a%W-1,row=((a/W)|0)-1,delta=z-a;
  const dir=delta===1?0:delta===W?1:delta===-1?2:delta===-W?3:-1;
  if(dir<0||col<0||col>8||row<0||row>8)throw Error('Unsupported placement move '+move);
  return dir*81+row*9+col;
}
export function rawFullObservation(game) {
  if(game.n!==2||game.boards[0].g.size!==5)throw Error('Full neural model requires 2-player 5x5');
  if(game.phase!==INIT&&game.phase!==PLACE&&game.phase!==PICK)throw Error('Cannot evaluate terminal state');
  const board=new Uint8Array(324),aux=new Float32Array(FULL_AUX),actor=game.player;
  let p=0;
  for(const b of [game.boards[actor],game.boards[1-actor]]) {
    for(let y=1;y<=9;y++)for(let x=1;x<=9;x++) {
      const i=y*b.g.W+x;board[p++]=b.t[i];board[p++]=b.c[i];
    }
  }
  const put=(line,offset)=>{
    if(!line)return;
    for(let i=0;i<Math.min(4,line.length);i++){
      const d=line[i],j=4*d,o=offset+5*i;
      aux[o]=DOM[j]/7;aux[o+1]=DOM[j+1]/3;
      aux[o+2]=DOM[j+2]/7;aux[o+3]=DOM[j+3]/3;aux[o+4]=(d+1)/48;
    }
  };
  put(game.line,0);put(game.nextLine,20);
  for(let i=0;i<4;i++) {
    aux[40+i]=game.own&&i<game.own.length?game.own[i]+1:0;
    aux[44+i]=game.nextOwn&&i<game.nextOwn.length?game.nextOwn[i]+1:0;
  }
  aux[48+game.phase]=1;
  aux[51]=game.boards[actor].placed/12;aux[52]=game.boards[1-actor].placed/12;
  aux[53]=game.left/24;aux[54]=game.middle?1:0;aux[55]=game.harmony?1:0;
  aux[56]=actor;aux[57]=game.idx/4;
  // Seen tiles are public, plus all visible dominoes, never reading game.deck.
  for(let i=0;i<48;i++)aux[58+i]=game.seen[i]?1:0;
  for(const line of [game.line,game.nextLine])if(line)for(const d of line)aux[58+d]=1;
  return {board,aux};
}
export function spatialFull(board,aux) {
  if(board.length!==324)throw Error('Invalid raw spatial tensor size');
  const tensor=new Float32Array(FULL_SPATIAL_CHANNELS*81);
  for(let p=0;p<2;p++)for(let i=0;i<81;i++) {
    const off=p*162+i*2,t=board[off],c=board[off+1];
    if(t>8||c>3)throw Error('Bad terrain/crown code');
    tensor[(p*10+t)*81+i]=1;
    tensor[(p*10+9)*81+i]=c/3;
  }
  if(aux){
    // The active domino is broadcast across the map so placement logits
    // represent the placement of THIS specific tile, not a generic region.
    const idx=Math.min(3,Math.max(0,Math.round(aux[57]*4)));
    for(let k=0;k<4;k++)tensor.fill(aux[5*idx+k],(20+k)*81,(21+k)*81);
  }
  return tensor;
}
