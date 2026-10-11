// Dependency-free mini-batch Adam trainer for a raw-board policy+value network.
// Two fully connected ReLU layers (64 wide) and independent policy/value heads.
// Dense 355-to-64 matrix learns board features rather than handcrafted synergy.
// Train: node scripts/neural/train.js --dir data/ --out weights.json
//        --epochs 12 --seed 9000 [--init older-model.json]
// Input generation uses real determinized MCTS self-play; validation is separated
// by whole game seeds, evaluated without spatial augmentation.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeNeuralWeights, NeuralDraftNet } from '../../src/core/search/neuralPolicy.js';
import { NEURAL_INPUT } from '../../src/core/search/neuralObservation.js';
import { mulberry32 } from '../../src/core/rng.js';

function arg(k,def){const i=process.argv.indexOf('--'+k);return i<0?def:process.argv[i+1];}
const num=(k,def)=>+arg(k,def);
const dirname=arg('dir','data'),output=arg('out','neural-model.json'),
 epochs=num('epochs',12),lr=num('lr',0.0007),seed=num('seed',9000),
 init=arg('init',null),batchSize=num('batch',32),validationThreshold=num('valid-seed',900000);
const names=['w1','b1','w2','b2','w3','b3'],rand=mulberry32(seed);
function files(root){const found=[];for(const x of readdirSync(root,{withFileTypes:true})){
 const p=join(root,x.name);if(x.isDirectory())found.push(...files(p));else if(x.name.endsWith('.json'))found.push(p);
}return found;}
const games=[],seen=new Set(),srcFiles=files(dirname);
for(const file of srcFiles){
 const shard=JSON.parse(readFileSync(file,'utf8'));
 if(shard.format!=='neural-draft-selfplay-v1')continue;
 for(const g of shard.gamesData){
   if(seen.has(g.seed))throw Error('Duplicated self-play seed '+g.seed);
   seen.add(g.seed);games.push(g);
 }
}
if(!games.length)throw Error('No valid self-play datasets');
const train=[],valid=[];
for(const game of games){
 const target=game.seed>=validationThreshold?valid:train;
 for(const r of game.records){
   if(r.x.length!==NEURAL_INPUT||r.pi.length!==4)throw Error('Bad input '+game.seed);
   target.push({x:Float32Array.from(r.x),pi:Float32Array.from(r.pi),value:r.value});
 }
}
if(!train.length||!valid.length)throw Error('Both train and independent game validation required: '+JSON.stringify({train:train.length,valid:valid.length}));
const net=new NeuralDraftNet(init?JSON.parse(readFileSync(init,'utf8')):makeNeuralWeights(seed));
const params=names.map(x=>net.w[x]);
const grads=params.map(a=>new Float64Array(a.length)),
  moments=params.map(a=>new Float64Array(a.length)),
  seconds=params.map(a=>new Float64Array(a.length));
const positionMaps=Array.from({length:8},(_,kind)=>{
 const m=new Uint16Array(81);for(let y=0;y<9;y++)for(let x=0;x<9;x++){
   let xx=x,yy=y;
   for(let k=0;k<(kind&3);k++){const v=xx;xx=8-yy;yy=v;}
   if(kind&4)xx=8-xx;
   m[y*9+x]=yy*9+xx;
 }return m;
});
function transform(x,k){
 if(k===0)return x;
 const y=x.slice(),map=positionMaps[k];
 for(let board=0;board<2;board++){
   const base=board*162;
   for(let cell=0;cell<81;cell++){
     const old=base+cell*2,at=base+map[cell]*2;
     y[at]=x[old];y[at+1]=x[old+1];
   }
 }
 return y;
}
const start=performance.now();
function evaluation(samples){
 const N=samples.length,subset=Math.min(N,1800);
 let loss=0,policy=0,value=0,correct=0;
 for(let k=0;k<subset;k++){
   const r=samples[(k*N/subset)|0],mask=r.x.subarray(344,348);
   const pred=net.forward(r.x,mask),pi=pred.policy;
   let ce=0,bi=0,bp=0,targ=0;
   for(let j=0;j<4;j++){
     ce-=r.pi[j]*Math.log(Math.max(1e-10,pi[j]));
     if(pi[j]>bp){bp=pi[j];bi=j;}
     if(r.pi[j]>r.pi[targ])targ=j;
   }
   const vl=(pred.value-r.value)**2,ls=ce+0.25*vl;
   loss+=ls;policy+=ce;value+=vl;correct+=+(bi===targ);
 }
 return {loss:loss/subset,policyCE:policy/subset,valueMSE:value/subset,policyTop:correct/subset,observations:subset};
}
let best=Infinity,bestJson=null,bestEpoch=0,steps=0,history=[];
for(let epoch=0;epoch<epochs;epoch++){
 const order=Array.from({length:train.length},(_,i)=>i);
 for(let i=order.length-1;i>0;i--){const j=(rand()*(i+1))|0;[order[i],order[j]]=[order[j],order[i]];}
 let trainCE=0,trainValue=0;
 for(let offset=0;offset<order.length;offset+=batchSize){
   for(const g of grads)g.fill(0);
   const n=Math.min(batchSize,order.length-offset);
   for(let k=0;k<n;k++){
     const sample=train[order[offset+k]],x=transform(sample.x,(rand()*8)|0);
     const mask=x.subarray(344,348),pred=net.forward(x,mask);
     const {policy:p,value:v,a1,a2}=pred;
     const dl=new Float32Array(5);
     for(let j=0;j<4;j++){
       dl[j]=p[j]-sample.pi[j];
       trainCE-=sample.pi[j]*Math.log(Math.max(1e-10,p[j]));
     }
     const ve=v-sample.value;
     trainValue+=ve*ve;
     dl[4]=0.5*ve*(1-v*v);
     const [w1,b1,w2,b2,w3,b3]=params;
     const [dw1,db1,dw2,db2,dw3,db3]=grads;
     const dz2=new Float32Array(64),dz1=new Float32Array(64);
     for(let i=0;i<64;i++){
       let back=0;
       for(let j=0;j<5;j++){dw3[i*5+j]+=a2[i]*dl[j];back+=w3[i*5+j]*dl[j];}
       dz2[i]=a2[i]>0?back:0;
     }
     for(let j=0;j<5;j++)db3[j]+=dl[j];
     for(let i=0;i<64;i++){
       let back=0;
       for(let j=0;j<64;j++){dw2[i*64+j]+=a1[i]*dz2[j];back+=w2[i*64+j]*dz2[j];}
       dz1[i]=a1[i]>0?back:0;
     }
     for(let j=0;j<64;j++)db2[j]+=dz2[j];
     for(let i=0;i<NEURAL_INPUT;i++){
       const xi=x[i];if(!xi)continue;
       for(let j=0;j<64;j++)dw1[i*64+j]+=xi*dz1[j];
     }
     for(let j=0;j<64;j++)db1[j]+=dz1[j];
   }
   steps++;
   const b1=1-Math.pow(.9,steps),b2=1-Math.pow(.999,steps);
   for(let z=0;z<params.length;z++){
     const p=params[z],g=grads[z],m=moments[z],v=seconds[z];
     const weight=(z%2===0)?1e-5:0;
     for(let i=0;i<p.length;i++){
       const dx=g[i]/n+weight*p[i];
       m[i]=.9*m[i]+.1*dx;v[i]=.999*v[i]+.001*dx*dx;
       p[i]-=lr*(m[i]/b1)/(Math.sqrt(v[i]/b2)+1e-8);
     }
   }
 }
 const v=evaluation(valid),t=evaluation(train);
 history.push({epoch:epoch+1,train:t,valid:v});
 if(v.policyCE<best){best=v.policyCE;bestEpoch=epoch+1;bestJson=net.json();}
 console.error(JSON.stringify({epoch:epoch+1,trainCE:trainCE/train.length,trainValueMSE:trainValue/train.length,validation:v,seconds:(performance.now()-start)/1000}));
}
writeFileSync(output,JSON.stringify(bestJson));
const result={model:output,bestEpoch,seed,lr,epochs,batchSize,seenGames:games.length,
 trainGames:games.filter(g=>g.seed<validationThreshold).length,
 validGames:games.filter(g=>g.seed>=validationThreshold).length,
 trainObservations:train.length,validObservations:valid.length,
 startCheckpoint:init,history,seconds:(performance.now()-start)/1000};
writeFileSync(output.replace(/\.json$/,'.report.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({model:output,bestEpoch,bestValidation:history[bestEpoch-1].valid,
 trainingExamples:train.length,validationExamples:valid.length,seconds:result.seconds}));
