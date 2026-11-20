#!/usr/bin/env python3
from pathlib import Path
import pcbnew as k,json,math,gc,os
import sexpdata as sx
gc.disable()
ROOT=Path(__file__).resolve().parent
try:
 data=sx.loads((ROOT/'aquasense-v1.kicad_pcb').read_text())
 data=[n for n in data if not (isinstance(n,list) and n and str(n[0])=='gr_text')]
 (ROOT/'aquasense-v1.kicad_pcb').write_text(sx.dumps(data))
 b=k.LoadBoard(str(ROOT/'aquasense-v1.kicad_pcb'))
 def mm(x):return k.FromMM(x)
 def vec(x,y):return k.VECTOR2I(mm(x),mm(y))
 def box(item,margin=0):
  r=item.GetBoundingBox();return (k.ToMM(r.GetLeft())-margin,k.ToMM(r.GetTop())-margin,k.ToMM(r.GetRight())+margin,k.ToMM(r.GetBottom())+margin)
 def intersects(a,z):return a[0]<z[2] and a[2]>z[0] and a[1]<z[3] and a[3]>z[1]
 obstacles={k.F_SilkS:[],k.B_SilkS:[]}
 for f in b.GetFootprints():
  f.Reference().SetVisible(False);f.Value().SetVisible(False)
  for p in f.Pads():
   for layer in obstacles:obstacles[layer].append(box(p,.28))
  for g in f.GraphicalItems():
   if g.GetLayer()==k.F_SilkS:obstacles[k.F_SilkS].append(box(g,.18))
 for t in b.GetTracks():
  if isinstance(t,k.PCB_VIA):
   for layer in obstacles:obstacles[layer].append(box(t,.25))
 def place(value,x,y,layer=k.F_SilkS,size=.85,radius=6,angle=0):
  text=k.PCB_TEXT(b);text.SetText(value);text.SetTextSize(vec(size,size));text.SetTextThickness(mm(.13));text.SetLayer(layer);text.SetMirrored(layer==k.B_SilkS)
  text.SetTextAngle(k.EDA_ANGLE(angle,k.DEGREES_T))
  offsets=[(dx,dy) for dx in [v*.5 for v in range(-int(radius*2),int(radius*2)+1)] for dy in [v*.5 for v in range(-int(radius*2),int(radius*2)+1)]];offsets.sort(key=lambda a:a[0]**2+a[1]**2)
  for dx,dy in offsets:
   text.SetPosition(vec(x+dx,y+dy));r=box(text,.18)
   if r[0]<.5 or r[2]>79.5 or r[1]<5.5 or r[3]>64.5:continue
   if any(intersects(r,z) for z in obstacles[layer]):continue
   b.Add(text);obstacles[layer].append(r);return
  raise RuntimeError('No safe silk position: '+value)
 place('AquaSense v1.0 - DATN 2026',47.7,62,size=.9)
 place('ANTENNA / NO COPPER',48,10,size=.9)
 place('USB v',47.7,59,size=.9)
 manifest=json.loads((ROOT/'design-manifest.json').read_text())
 for c in manifest['components']:
  ref=c['ref'];x=c['x'];y=c['y']
  if ref.startswith('H'):continue
  if ref.startswith('J'):continue
  if ref.startswith('TP'):value=ref
  elif ref.startswith('J'):value=ref+' '+{'J1':'DS18B20','J2':'pH','J3':'CLARITY','J4':'PIR'}[ref]
  else:value=ref
  place(value,x,y-2.5,size=.85,radius=9)
 # All XH latch faces point toward board -X.  Per-pin labels sit immediately
 # to the right of their pad row and are readable while inserting the keyed
 # cable from the left.  Module names are vertical to preserve analog space.
 connector_labels={
  'J2':('PH-4502C',['PO','G','G','V+'],16.0),
  'J3':('CLARITY',['VCC','OUT','GND'],27.5),
  'J1':('DS18B20',['VDD','GND','DQ'],38.5),
  'J4':('PIR',['VCC','OUT','GND'],49.5),
 }
 for ref,(module,pins,y0) in connector_labels.items():
  for index,label in enumerate(pins):
   try:place(label,7.0,y0-index*2.5,size=.8,radius=.7)
   except RuntimeError as error:raise RuntimeError(f'{ref}.{index+1} {label}: {error}') from error
  module_y=16.0 if ref=='J2' else y0-(len(pins)-1)*1.25
  place(ref+' '+module,4.5,module_y,size=.8,radius=1.2,angle=90)
 # Detailed assembly legend printed on the bottom, readable when board is flipped.
 rows=['U1: 2x 1x15 SOCKET','J1 XH3: VDD GND DQ','J2 XH4: PO G G V+','J3 XH3: VCC OUT GND','J4 XH3: VCC OUT GND','R1 4.7k 1%','R2/R3 10k 1% (pH)','R4/R5 10k 1% (CLARITY)','R6 330R 1% / D1 LED','C1 100uF 16V','C2/C3/C4/C6 100nF','C5 10uF 16V','F1 MF-RHT050 0.5A','PH: 5V -> 2.5V','CLARITY: 4.5V -> 2.25V','XH LATCH -> LEFT','SOCKET 25.4mm MEASURED','MEASURED 2026-11-18','TP1=5V TP2=3V3 TP3=GND','TP4=PH_ADC TP5=TURB_ADC','TP6=TEMP_DQ']
 for i,value in enumerate(rows):place(value,47.7,19+i*2.05,k.B_SilkS,.8,6)
 k.SaveBoard(str(ROOT/'aquasense-v1.kicad_pcb'),b)
 print('Silk labels positioned clear of pads, holes and other printing.')
except Exception as error:
 print(type(error).__name__,str(error),flush=True)
 os._exit(1)
