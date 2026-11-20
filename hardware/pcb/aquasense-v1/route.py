#!/usr/bin/env python3
"""Conservative two-layer grid router. KiCad DRC is the final authority."""
from pathlib import Path
import pcbnew as k
import math,heapq,itertools,json,time
ROOT=Path(__file__).resolve().parent
b=k.LoadBoard(str(ROOT/'aquasense-v1.kicad_pcb'))
def mm(x):return k.FromMM(x)
def xy(p):return (k.ToMM(p.x),k.ToMM(p.y))
def vec(x,y):return k.VECTOR2I(mm(x),mm(y))
step=.25;W=321;H=261
# Store copper disks for clearance checks. Different widths are handled at route time.
objects=[[],[]]
pads={}
for f in b.GetFootprints():
 for p in f.Pads():
  x,y=xy(p.GetPosition());size=xy(p.GetSize());n=p.GetNetname();r=max(size)/2 if p.GetShape()==k.PAD_SHAPE_CIRCLE else math.hypot(*size)/2
  if p.GetAttribute()==k.PAD_ATTRIB_NPTH:r=max(xy(p.GetDrillSize()))/2
  for layer in range(2):objects[layer].append((x,y,r,n))
  if n:pads.setdefault(n,[]).append((x,y))
# Board edge copper setback and antenna rectangle.
keep=tuple(json.loads((ROOT/'design-manifest.json').read_text())['antenna_keepout'])
def blocked_for(net,width):
 radius=width/2+.225;blocked=[set(),set()]
 for layer in range(2):
  for x,y,r,n in objects[layer]:
   if n==net:continue
   dist=r+radius
   for ix in range(max(0,int((x-dist)/step)),min(W,int((x+dist)/step)+2)):
    for iy in range(max(0,int((y-dist)/step)),min(H,int((y+dist)/step)+2)):
     if (ix*step-x)**2+(iy*step-y)**2<dist**2:blocked[layer].add((ix,iy))
 return blocked
moves=[(1,0,1),(-1,0,1),(0,1,1),(0,-1,1),(1,1,1.414),(-1,1,1.414),(1,-1,1.414),(-1,-1,1.414)]
segments=0;vias=0
# Escape the closely spaced three-pin sensor headers before routing the ADC
# branches around R2/R4; otherwise a valid ADC path can close the only channel
# out of J3 after J1 is rotated into a vertical pad row.
netorder=['PH_OUT','TURB_OUT','PH_ADC','TURB_ADC','+5V_RAW','+5V','+3V3','TEMP_DQ','LED_OUT','LED_A','PIR_OUT']
def route(net,a,z,width):
 global segments,vias
 blocked=blocked_for(net,width)
 start=(round(a[0]/step),round(a[1]/step));goal=(round(z[0]/step),round(z[1]/step))
 def valid(x,y,l):
  xx=x*step;yy=y*step;margin=.35+width/2
  return margin<=xx<=80-margin and 5+margin<=yy<=65-margin and not (keep[0]-width/2-.2<=xx<=keep[2]+width/2+.2 and yy<=keep[3]+width/2+.2) and (x,y) not in blocked[l]
 def h(x,y):return math.hypot(x-goal[0],y-goal[1])
 heap=[];cost={};parent={};serial=itertools.count()
 for l in range(2):
  state=(*start,l);cost[state]=0;heapq.heappush(heap,(h(*start),next(serial),state))
 end=None
 while heap:
  _,_,u=heapq.heappop(heap);x,y,l=u;g=cost[u]
  if (x,y)==goal:end=u;break
  for dx,dy,d in moves:
   xx=x+dx;yy=y+dy
   if not valid(xx,yy,l):continue
   if dx and dy and (not valid(x+dx,y,l) or not valid(x,y+dy,l)):continue
   v=(xx,yy,l);ng=g+d+(0.025 if (l==0 and dx==0) or (l==1 and dy==0) else 0)
   if ng<cost.get(v,1e99):cost[v]=ng;parent[v]=u;heapq.heappush(heap,(ng+h(xx,yy),next(serial),v))
  # Via must clear both layers with its entire 0.6mm diameter.
  if valid(x,y,1-l) and valid(x,y,l):
   xx=x*step;yy=y*step
   clear=all(n==net or (xx-ox)**2+(yy-oy)**2>=(r+.3+.225)**2 for layer in objects for ox,oy,r,n in layer)
   if clear:
    v=(x,y,1-l);ng=g+24
    if ng<cost.get(v,1e99):cost[v]=ng;parent[v]=u;heapq.heappush(heap,(ng+h(x,y),next(serial),v))
 if end is None:raise RuntimeError(f'No route {net}: {a}->{z}')
 path=[end]
 while path[-1] in parent:path.append(parent[path[-1]])
 path.reverse()
 points=[(a[0],a[1],path[0][2])]+[(x*step,y*step,l) for x,y,l in path]+[(z[0],z[1],path[-1][2])]
 # Collapse collinear segments but preserve every layer change.
 clean=[points[0]]
 for p in points[1:]:
  if p==clean[-1]:continue
  if len(clean)>1:
   a0,a1=clean[-2:]
   if a0[2]==a1[2]==p[2] and abs((a1[0]-a0[0])*(p[1]-a1[1])-(a1[1]-a0[1])*(p[0]-a1[0]))<1e-8:clean[-1]=p;continue
  clean.append(p)
 netobj=b.FindNet(net)
 for a0,a1 in zip(clean,clean[1:]):
  if a0[2]!=a1[2]:
   via=k.PCB_VIA(b);via.SetPosition(vec(a0[0],a0[1]));via.SetWidth(k.F_Cu,mm(.6));via.SetDrill(mm(.3));via.SetViaType(k.VIATYPE_THROUGH);via.SetLayerPair(k.F_Cu,k.B_Cu);via.SetNet(netobj);b.Add(via);vias+=1
   for l in range(2):objects[l].append((a0[0],a0[1],.3,net))
  else:
   t=k.PCB_TRACK(b);t.SetStart(vec(a0[0],a0[1]));t.SetEnd(vec(a1[0],a1[1]));t.SetWidth(mm(width));t.SetLayer(k.F_Cu if a0[2]==0 else k.B_Cu);t.SetNet(netobj);b.Add(t);segments+=1
   length=math.dist(a0[:2],a1[:2]);count=max(1,math.ceil(length/.15))
   for i in range(count+1):
    f=i/count;objects[a0[2]].append((a0[0]+f*(a1[0]-a0[0]),a0[1]+f*(a1[1]-a0[1]),width/2,net))
 print(net,tuple(round(x,2) for x in a),'->',tuple(round(x,2) for x in z),'vias',vias,flush=True)
for net in netorder:
 points=sorted(pads[net]);connected=[points[0]];remaining=points[1:]
 while remaining:
  _,a,z=min((math.dist(a,z),a,z) for a in connected for z in remaining)
  route(net,a,z,.7 if net.startswith('+') else .3);connected.append(z);remaining.remove(z)
# Copper pours use direct connection to GND pads for generous hand-solder pad coverage.
for layer in [k.F_Cu,k.B_Cu]:
 zone=k.ZONE(b);zone.SetLayer(layer);zone.SetNet(b.FindNet('GND'));zone.SetLocalClearance(mm(.2));zone.SetPadConnection(k.ZONE_CONNECTION_THERMAL);zone.SetThermalReliefGap(mm(.25));zone.SetThermalReliefSpokeWidth(mm(.4));zone.SetMinThickness(mm(.2));zone.SetZoneName('GND plane');outline=zone.Outline();outline.NewOutline()
 for x,y in [(.4,5.4),(79.6,5.4),(79.6,64.6),(.4,64.6)]:outline.Append(mm(x),mm(y))
 b.Add(zone)
# Stitching vias away from pads/tracks and antenna. GND can touch other GND copper.
for x,y in [(x,7) for x in range(10,80,8)]+[(x,63) for x in range(10,75,8)]+[(2,y) for y in range(15,60,7)]+[(78,y) for y in range(15,60,7)]+[(24,y) for y in [19,30,38,44,52]]:
 if keep[0]-.5<x<keep[2]+.5 and y<keep[3]+.5:continue
 if not all(n=='GND' or (x-ox)**2+(y-oy)**2>(r+.3+.25)**2 for layer in objects for ox,oy,r,n in layer):continue
 via=k.PCB_VIA(b);via.SetPosition(vec(x,y));via.SetWidth(k.F_Cu,mm(.6));via.SetDrill(mm(.3));via.SetLayerPair(k.F_Cu,k.B_Cu);via.SetViaType(k.VIATYPE_THROUGH);via.SetNet(b.FindNet('GND'));b.Add(via);vias+=1
k.ZONE_FILLER(b).Fill(b.Zones())
k.SaveBoard(str(ROOT/'aquasense-v1.kicad_pcb'),b)
print('Routed',segments,'segments and',vias,'vias',flush=True)
