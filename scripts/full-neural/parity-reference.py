#!/usr/bin/env python3
"""Create PyTorch reference outputs for a network exported to the JS CPU runtime."""
import importlib.util,json,pathlib,sys,torch,numpy as np
src=pathlib.Path(__file__).with_name('train.py')
spec=importlib.util.spec_from_file_location('full_train',src)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
weights=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert weights['version']==3
net=module.FullNet(weights['channels'],weights['blocks'],weights['auxWidth'])
names=['stem']+[f'res{i}{a}' for i in range(weights['blocks']) for a in 'ab']+['place','aux_fc','draft','discard','value']
state={}
for name in names:
    for key,short in [('weight','W'),('bias','B')]:
        template=net.state_dict()[name+'.'+key]
        state[name+'.'+key]=torch.tensor(weights[name+short],dtype=torch.float32).view(template.shape)
net.load_state_dict(state);net.eval()
board=[]
for player in range(2):
    for i in range(81):board.extend([(i*7+player*3)%9,(i*3+player)%4])
aux=[((i*17)%103)/103 for i in range(106)]
aux[57]=0.5
sample={'board':board,'aux':aux,'indices':[0],'probs':[1.0],'phase':0,'value':0}
spatial,a,_,_,_=module.encode(sample,0)
with torch.no_grad():
    logits,value=net(torch.from_numpy(spatial[None,...]),torch.from_numpy(a[None,...]))
result={'board':board,'aux':aux,'draft':logits[0,:4].tolist(),
        'place':logits[0,4:328].tolist(),'discard':float(logits[0,328]),
        'value':float(value[0])}
pathlib.Path(sys.argv[2]).write_text(json.dumps(result))
print('Wrote reference outputs for',weights['channels'],'channels and',weights['blocks'],'blocks')
