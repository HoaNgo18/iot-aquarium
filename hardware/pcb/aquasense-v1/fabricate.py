#!/usr/bin/env python3
"""Export manufacturing files, previews and an A4 actual-size assembly sheet."""
from pathlib import Path
import hashlib,json,shutil,subprocess,zipfile
import pcbnew as k

ROOT=Path(__file__).resolve().parent
BOARD=ROOT/'aquasense-v1.kicad_pcb'
GERBER=ROOT/'fab'/'gerber'
PREVIEW=ROOT/'preview'
REPORTS=ROOT/'reports'
for folder in (GERBER,PREVIEW,REPORTS):folder.mkdir(parents=True,exist_ok=True)

def run(*args):
 print('+',' '.join(map(str,args)),flush=True)
 subprocess.run([str(a) for a in args],cwd=ROOT,check=True)

for path in GERBER.iterdir():
 if path.is_file():path.unlink()

layers='F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts'
run('kicad-cli','pcb','export','gerbers','--layers',layers,'--output',GERBER,BOARD)
run('kicad-cli','pcb','export','drill','--format','excellon','--excellon-units','mm',
    '--excellon-separate-th','--output',GERBER,BOARD)

# Board-only top artwork for documentation.
run('kicad-cli','pcb','export','svg','--layers','F.Cu,F.Mask,F.Silkscreen,Edge.Cuts',
    '--page-size-mode','2','--exclude-drawing-sheet','--drill-shape-opt','2',
    '--mode-single','--output',PREVIEW/'pcb-top.svg',BOARD)

render_prefix=['xvfb-run','-a'] if shutil.which('xvfb-run') else []
for side,name in [('top','top-3d.png'),('bottom','bottom-3d.png')]:
 run(*render_prefix,'kicad-cli','pcb','render','--output',PREVIEW/name,'--width','1600',
     '--height','1200','--side',side,'--quality','high','--background','transparent',BOARD)

# Create a temporary copy with a dimensionally exact 50 mm ruler outside the
# board.  KiCad PDF plots preserve physical units on the A4 drawing sheet.
print_board=PREVIEW/'_print-1to1.kicad_pcb'
b=k.LoadBoard(str(BOARD))
def mm(value):return k.FromMM(value)
def point(x,y):return k.VECTOR2I(mm(x),mm(y))
def line(x1,y1,x2,y2,width=.25):
 item=k.PCB_SHAPE(b);item.SetShape(k.SHAPE_T_SEGMENT);item.SetStart(point(x1,y1));item.SetEnd(point(x2,y2));item.SetLayer(k.Dwgs_User);item.SetWidth(mm(width));b.Add(item)
line(10,75,60,75,.35)
for x,height in [(10,4),(20,2),(30,2),(40,2),(50,2),(60,4)]:line(x,75-height/2,x,75+height/2)
for value,x,y,size in [('50 mm CHECK RULER',35,79,2),('PRINT AT 100% / ACTUAL SIZE',40,84,2)]:
 item=k.PCB_TEXT(b);item.SetText(value);item.SetPosition(point(x,y));item.SetTextSize(point(size,size));item.SetTextThickness(mm(.3));item.SetLayer(k.Dwgs_User);b.Add(item)
k.SaveBoard(str(print_board),b)
try:
 run('kicad-cli','pcb','export','pdf','--layers','F.Cu,F.Silkscreen,Edge.Cuts,User.Drawings',
     '--black-and-white','--drill-shape-opt','2','--mode-single',
     '--output',PREVIEW/'print-1to1.pdf',print_board)
finally:
 print_board.unlink(missing_ok=True)

zip_path=ROOT/'fab'/'aquasense-v1-gerber.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as archive:
 for path in sorted(GERBER.iterdir()):
  if path.is_file():archive.write(path,path.name)
hashes={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(GERBER.iterdir()) if path.is_file()}
(REPORTS/'fabrication-sha256.json').write_text(json.dumps(hashes,indent=2)+'\n')
print('Exported',len(hashes),'fabrication files and print-1to1.pdf')
