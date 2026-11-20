from pathlib import Path
import sexpdata as sx
ROOT=Path(__file__).resolve().parent
p=ROOT/'aquasense-v1.kicad_sch';data=sx.loads(p.read_text())
def tag(a,key):return isinstance(a,list) and a and str(a[0])==key
def one(a,key):return next((n for n in a if tag(n,key)),None)
for symbol in data:
 if tag(symbol,'symbol'):
  at=one(symbol,'at');x,y=float(at[1]),float(at[2]);ref=next(n for n in symbol if tag(n,'property') and n[1]=='Reference')[2]
  if ref.startswith('#'):continue
  for prop in symbol:
   if not tag(prop,'property') or prop[1] not in ['Reference','Value']:continue
   at=one(prop,'at');effects=one(prop,'effects');effects[:]=[n for n in effects if not tag(n,'justify')]
   if ref=='U1':at[1]=x;at[2]=y-(24 if prop[1]=='Reference' else 22)
   else:at[1]=x+4;at[2]=y+(-1.27 if prop[1]=='Reference' else 1.27);effects.append([sx.Symbol('justify'),sx.Symbol('left')])
 elif tag(symbol,'text'):
  effects=one(symbol,'effects');effects.append([sx.Symbol('justify'),sx.Symbol('left')])
p.write_text(sx.dumps(data))
