#!/usr/bin/env python3
"""Train an end-to-end residual policy/value model for all legal Kingdomino actions.
Uses PyTorch (GPU if available), whole-game validation, D4 augmentation of
both input boards AND spatial placement targets, and exports portable JS weights.

python scripts/full-neural/train.py --data shards --out model.json --epochs 12
"""
import argparse, json, math, random, copy, os, pathlib, gzip
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

A, BOARD, OPTIONS = 106, 81, 329
class FullNet(nn.Module):
    def __init__(self,channels=16,blocks=2,aux_width=32):
        super().__init__()
        self.channels=channels
        self.blocks=blocks
        self.aux_width=aux_width
        self.stem=nn.Conv2d(24,channels,3,padding=1)
        for block in range(blocks):
            setattr(self,f'res{block}a',nn.Conv2d(channels,channels,3,padding=1))
            setattr(self,f'res{block}b',nn.Conv2d(channels,channels,3,padding=1))
        self.place=nn.Conv2d(channels,4,1)
        self.aux_fc=nn.Linear(A,aux_width)
        self.draft=nn.Linear(channels+aux_width,4)
        self.discard=nn.Linear(channels+aux_width,1)
        self.value=nn.Linear(channels+aux_width,1)
    def forward(self,board,aux):
        h=F.relu(self.stem(board))
        for i in range(self.blocks):
            z=F.relu(getattr(self,f'res{i}a')(h))
            h=F.relu(h+getattr(self,f'res{i}b')(z))
        pooled=torch.cat((h.mean((2,3)),F.relu(self.aux_fc(aux))),dim=1)
        place=self.place(h).flatten(1)
        draft=self.draft(pooled)
        discard=self.discard(pooled)
        value=self.value(pooled).tanh().flatten()
        return torch.cat((draft,place,discard),dim=1),value

def d4(x,y,kind):
    for _ in range(kind&3):x,y=8-y,x
    if kind&4:x=8-x
    return x,y

def move_transform(i,kind):
    if i==328:return i
    if i<4:return i
    pos=i-4;d,local=divmod(pos,81);x,y=local%9,local//9
    dx,dy=((1,0),(0,1),(-1,0),(0,-1))[d]
    xx,yy=d4(x,y,kind);bx,by=d4(x+dx,y+dy,kind)
    v=(bx-xx,by-yy)
    if v not in ((1,0),(0,1),(-1,0),(0,-1)):
        raise ValueError('Nonadjacent move after D4')
    return 4+((1,0),(0,1),(-1,0),(0,-1)).index(v)*81+yy*9+xx

def encode(sample,kind=0):
    raw=sample['board'];aux=np.asarray(sample['aux'],dtype=np.float32)
    if len(raw)!=324 or len(aux)!=106:raise ValueError('Unexpected observation size')
    planes=np.zeros((24,9,9),dtype=np.float32)
    for player in range(2):
        for pos in range(81):
            t=int(raw[player*162+2*pos]);crowns=int(raw[player*162+2*pos+1])
            x,y=d4(pos%9,pos//9,kind)
            if t>8 or crowns>3:raise ValueError('Invalid terrain/crown')
            planes[player*10+t,y,x]=1
            planes[player*10+9,y,x]=crowns/3.
    slot=int(np.clip(round(aux[57]*4),0,3))
    for ch in range(4):planes[20+ch,:,:]=aux[slot*5+ch]
    target=np.zeros(OPTIONS,dtype=np.float32)
    mask=np.zeros(OPTIONS,dtype=np.bool_)
    if len(sample['indices'])!=len(sample['probs']):raise ValueError('Bad search visit targets')
    for index,prob in zip(sample['indices'],sample['probs']):
        k=int(index)+(0 if sample['phase']!=1 else 4)
        if sample['phase']==1 and int(index)==324:k=328
        k=move_transform(k,kind)
        if mask[k]:raise ValueError('Duplicate legal move mapping')
        target[k]=float(prob);mask[k]=True
    if not mask.any() or abs(float(target.sum())-1)>2e-4:raise ValueError('Invalid policy distribution')
    return planes,aux,target,mask,np.float32(sample['value'])

def files(path):
    return list(pathlib.Path(path).rglob('*.json')) + list(pathlib.Path(path).rglob('*.json.gz'))

def load(root,validation_seed):
    train,valid=[],[];seen=set()
    for path in files(root):
        data=json.loads(gzip.open(path,'rt').read() if path.name.endswith('.gz') else path.read_text())
        if data.get('format')!='full-neural-selfplay-v1':continue
        for episode in data['episodes']:
            seed=episode['seed']
            if seed in seen:raise ValueError(f'Duplicate game seed {seed}')
            seen.add(seed)
            (valid if seed>=validation_seed else train).extend(episode['observations'])
    if not train or not valid:raise ValueError('Need independent training and validation games')
    return train,valid,len(seen)

def pack(samples,indices,augment,device):
    rows=[encode(samples[i],random.randrange(8) if augment else 0) for i in indices]
    x=torch.from_numpy(np.stack([r[0] for r in rows])).to(device)
    aux=torch.from_numpy(np.stack([r[1] for r in rows])).to(device)
    targets=torch.from_numpy(np.stack([r[2] for r in rows])).to(device)
    mask=torch.from_numpy(np.stack([r[3] for r in rows])).to(device)
    values=torch.from_numpy(np.array([r[4] for r in rows],dtype=np.float32)).to(device)
    return x,aux,targets,mask,values

def evaluate(net,samples,device,batch_size=64):
    net.eval();t_ce=t_mse=t_best=0.
    with torch.no_grad():
        for lo in range(0,len(samples),batch_size):
            pack_ = pack(samples,range(lo,min(lo+batch_size,len(samples))),False,device)
            x,aux,target,mask,value=pack_
            logits,pred=net(x,aux)
            masked=logits.masked_fill(~mask,-1e9)
            t_ce+=float((-(target*F.log_softmax(masked,dim=1)).sum(dim=1)).sum().item())
            t_mse+=float(F.mse_loss(pred,value,reduction='sum').item())
            t_best+=float((masked.argmax(1)==target.argmax(1)).sum().item())
    n=len(samples)
    return {'policyCE':t_ce/n,'valueMSE':t_mse/n,'topVisitAccuracy':t_best/n,'examples':n}

def export(net,path):
    obj={'version':3,'channels':net.channels,'blocks':net.blocks,'auxWidth':net.aux_width,'aux':106}
    state=net.cpu().state_dict()
    for prefix in ['stem']+[f'res{i}{t}' for i in range(net.blocks) for t in 'ab']+['place','aux_fc','draft','discard','value']:
        obj[prefix+'W']=state[prefix+'.weight'].contiguous().reshape(-1).tolist()
        obj[prefix+'B']=state[prefix+'.bias'].contiguous().reshape(-1).tolist()
    pathlib.Path(path).write_text(json.dumps(obj,separators=(',',':')))
    return obj

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--data',default='shards')
    ap.add_argument('--out',default='model.json')
    ap.add_argument('--epochs',type=int,default=12)
    ap.add_argument('--batch',type=int,default=48)
    ap.add_argument('--lr',type=float,default=0.0007)
    ap.add_argument('--seed',type=int,default=507)
    ap.add_argument('--valid-seed',type=int,default=900000)
    ap.add_argument('--channels',type=int,default=16)
    ap.add_argument('--blocks',type=int,default=2)
    ap.add_argument('--aux-width',type=int,default=32)
    ap.add_argument('--init',default=None,help='Existing version-2 exported weights for replay-buffer fine-tuning')
    args=ap.parse_args()
    random.seed(args.seed);np.random.seed(args.seed);torch.manual_seed(args.seed)
    torch.set_num_threads(min(4,os.cpu_count() or 1))
    train,valid,games=load(args.data,args.valid_seed)
    device=torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    net=FullNet(args.channels,args.blocks,args.aux_width).to(device)
    if args.init:
        previous=json.loads(pathlib.Path(args.init).read_text())
        if previous.get('aux')!=A or previous.get('channels')!=args.channels or previous.get('blocks',2)!=args.blocks or previous.get('auxWidth',32)!=args.aux_width:
            raise ValueError('Initial checkpoint does not match requested network dimensions')
        layer_names=['stem']+[f'res{i}{t}' for i in range(args.blocks) for t in 'ab']+['place','aux_fc','draft','discard','value']
        state={}
        for layer in layer_names:
            for suffix,ext in [('weight','W'),('bias','B')]:
                name=layer+'.'+suffix
                current=net.state_dict()[name]
                state[name]=torch.tensor(previous[layer+ext],dtype=torch.float32).reshape(current.shape)
        net.load_state_dict(state)
    opt=torch.optim.AdamW(net.parameters(),lr=args.lr,weight_decay=1e-5)
    best=float('inf');weights=None;best_epoch=0;history=[]
    for epoch in range(args.epochs):
        order=list(range(len(train)));random.shuffle(order);net.train()
        for lo in range(0,len(order),args.batch):
            x,aux,targets,mask,values=pack(train,order[lo:lo+args.batch],True,device)
            scores,pred=net(x,aux)
            ce=(-(targets*F.log_softmax(scores.masked_fill(~mask,-1e9),dim=1)).sum(dim=1)).mean()
            loss=ce+0.25*F.mse_loss(pred,values)
            opt.zero_grad();loss.backward();nn.utils.clip_grad_norm_(net.parameters(),3.)
            opt.step()
        v=evaluate(net,valid,device)
        history.append({'epoch':epoch+1,'valid':v})
        if v['policyCE']<best:
            best=v['policyCE'];best_epoch=epoch+1
            weights={k:t.detach().cpu().clone() for k,t in net.state_dict().items()}
        print(json.dumps({'epoch':epoch+1,'validation':v}),flush=True)
    net.load_state_dict(weights);output=export(net,args.out)
    report={'games':games,'trainExamples':len(train),'validExamples':len(valid),
        'bestEpoch':best_epoch,'validation':history[best_epoch-1]['valid'],
        'architecture':f'24x9x9 -> {args.channels}ch residual{args.blocks}, 4x9x9 placement, 4 draft, discard, signed value',
        'device':str(device),'initialCheckpoint':args.init,
        'channels':args.channels,'blocks':args.blocks,'auxWidth':args.aux_width,
        'parameterCount':sum(p.numel() for p in net.parameters()),
        'trainingHistory':history}
    report_path=args.out.replace('.json','.report.json')
    pathlib.Path(report_path).write_text(json.dumps(report,indent=2))
    print(json.dumps({'model':args.out,'report':report_path,**{k:report[k] for k in ['games','trainExamples','validExamples','bestEpoch','validation','parameterCount']}}))

if __name__=='__main__': main()
