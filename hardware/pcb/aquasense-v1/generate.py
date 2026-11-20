#!/usr/bin/env python3
"""Generate with KiCad 9's Python + sexpdata; see README for invocation.
Only the ESP32 carrier symbol/footprint is custom. Dimensions in millimetres.
"""
from pathlib import Path
import json,uuid,copy,csv,math,heapq,itertools
import sexpdata as sx
import pcbnew as k
ROOT=Path(__file__).resolve().parent
PARAMS={'row_spacing_mm':25.4,'pitch_mm':2.54,'board_width_mm':80,'board_height_mm':60,'board_top_mm':5,'header_x_mm':35,'header_y_mm':20}
param_file=ROOT/'parameters.json'
if param_file.exists():PARAMS.update(json.loads(param_file.read_text()))
else:param_file.write_text(json.dumps(PARAMS,indent=2)+'\n')
P=PARAMS
for folder in ['aquasense.pretty','reports','fab','preview']: (ROOT/folder).mkdir(exist_ok=True)
def uid(name):return str(uuid.uuid5(uuid.NAMESPACE_URL,'aquasense-v1/'+name))
def q(s):return json.dumps(str(s),ensure_ascii=False)
def S(s):return sx.Symbol(s)
def tag(x,key):return isinstance(x,list) and x and str(x[0])==key
def one(xs,key):return next((x for x in xs if tag(x,key)),None)
def layers(*ids):
 result=k.LSET()
 for layer in ids:result.AddLayer(layer)
 return result
def mm(n):return k.FromMM(n)
def pos(x,y):return k.VECTOR2I(mm(x),mm(y))
RFP='Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'
CFP='Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm'
XH3='Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical'
XH4='Connector_JST:JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical'
left=['EN','VP_GPIO36','VN_GPIO39','D34_GPIO34','D35_GPIO35','D32_GPIO32','D33_GPIO33','D25_GPIO25','D26_GPIO26','D27_GPIO27','D14_GPIO14','D12_GPIO12','D13_GPIO13','GND','VIN_5V_RAW']
right=['D23_GPIO23','D22_GPIO22','TX0_GPIO1','RX0_GPIO3','D21_GPIO21','D19_GPIO19','D18_GPIO18','D5_GPIO5','TX2_GPIO17','RX2_GPIO16','D4_GPIO4','D2_GPIO2','D15_GPIO15','GND','3V3']
# U1 pins 1..15 left top-down; 16..30 right top-down.
u1nets={4:'PH_ADC',5:'TURB_ADC',9:'LED_OUT',10:'PIR_OUT',14:'GND',15:'+5V_RAW',26:'TEMP_DQ',29:'GND',30:'+3V3'}
components=[]
def add(ref,value,symbol,fp,nets,x,y,angle=0,note=''):
 components.append(dict(ref=ref,value=value,symbol=symbol,fp=fp,nets={str(a):b for a,b in nets.items()},x=x,y=y,angle=angle,note=note,uuid=uid(ref)))
add('U1','ESP32 DevKit V1 30-pin','aquasense:ESP32_DevKit_30','aquasense:ESP32_DevKit_30',u1nets,P['header_x_mm'],P['header_y_mm'],note='2 female 1x15 sockets; centres measured 25.4 mm on physical ESP-WROOM-32S DOIT DevKit V1 board on 2026-11-18')
# The distinctive latch edge of the vertical XH footprint is local -Y.  At
# 90 degrees it faces board -X, so all four keyed cable housings are inserted
# from the same side and route toward the left edge.  x=11.5 leaves at least
# 8 mm from the latch/front outline to the board edge.
add('J1','B3B-XH-A / DS18B20','Connector_Generic:Conn_01x03',XH3,{1:'+3V3',2:'GND',3:'TEMP_DQ'},11.5,38.5,90,note='JST-XH 3P; 1=VDD 2=GND 3=DQ; latch faces left')
add('J2','B4B-XH-A / PH-4502C','Connector_Generic:Conn_01x04',XH4,{1:'PH_OUT',2:'GND',3:'GND',4:'+5V'},11.5,16,90,note='JST-XH 4P; matches PH-4502C final four pins PO G G V+; latch faces left')
add('J3','B3B-XH-A / MJKDZ clarity','Connector_Generic:Conn_01x03',XH3,{1:'+5V',2:'TURB_OUT',3:'GND'},11.5,27.5,90,note='JST-XH 3P; 1=VCC 2=OUT 3=GND; latch faces left')
add('J4','B3B-XH-A / HC-SR501 optional','Connector_Generic:Conn_01x03',XH3,{1:'+5V',2:'PIR_OUT',3:'GND'},11.5,49.5,90,note='JST-XH 3P; 1=VCC 2=OUT 3=GND; latch faces left; verify 3.3 V logic')
add('R1','4.7k 1%','Device:R',RFP,{1:'+3V3',2:'TEMP_DQ'},21,46)
add('R2','10k 1%','Device:R',RFP,{1:'PH_OUT',2:'PH_ADC'},21,21)
add('R3','10k 1%','Device:R',RFP,{1:'PH_ADC',2:'GND'},21,28.5)
add('R4','10k 1%','Device:R',RFP,{1:'TURB_OUT',2:'TURB_ADC'},21,37)
add('R5','10k 1%','Device:R',RFP,{1:'TURB_ADC',2:'GND'},21,42)
add('R6','330R 1% optional','Device:R',RFP,{1:'LED_OUT',2:'LED_A'},66,30,90)
add('D1','LED 3mm optional','Device:LED','LED_THT:LED_D3.0mm',{1:'GND',2:'LED_A'},69,36)
add('F1','MF-RHT050 500mA','Device:Polyfuse','Fuse:Fuse_Bourns_MF-RHT050',{1:'+5V_RAW',2:'+5V'},67,54,note='0.5 A hold; NOT MF-RG500 (5 A)')
add('C1','100uF 16V','Device:C_Polarized','Capacitor_THT:CP_Radial_D6.3mm_P2.50mm',{1:'+5V',2:'GND'},22,11)
add('C2','100nF','Device:C',CFP,{1:'+5V',2:'GND'},26,17)
add('C3','100nF','Device:C',CFP,{1:'PH_ADC',2:'GND'},32,25.08,180)
add('C4','100nF','Device:C',CFP,{1:'TURB_ADC',2:'GND'},32,32.70,180)
add('C5','10uF 16V','Device:C_Polarized','Capacitor_THT:CP_Radial_D5.0mm_P2.00mm',{1:'+3V3',2:'GND'},23,55)
add('C6','100nF','Device:C',CFP,{1:'+3V3',2:'GND'},27,61)
for i,(net,x,y) in enumerate([('+5V',30,12),('+3V3',19,58),('GND',19,62),('PH_ADC',20,24),('TURB_ADC',20,33),('TEMP_DQ',20,51)],1):
 add('TP'+str(i),net,'Connector:TestPoint','TestPoint:TestPoint_THTPad_D2.0mm_Drill1.0mm',{1:net},x,y)
for i,(x,y) in enumerate([(3.5,8.5),(76.5,8.5),(3.5,61.5),(76.5,61.5)],1):
 add('H'+str(i),'M3','Mechanical:MountingHole','MountingHole:MountingHole_3.2mm_M3',{},x,y)
# Custom DevKit footprint with exact pin numbering and standard-sized socket lands.
fp=k.FOOTPRINT(None);fp.SetReference('REF**');fp.SetValue('ESP32_DevKit_30');fp.SetFPID(k.LIB_ID('aquasense','ESP32_DevKit_30'));fp.SetAttributes(k.FP_THROUGH_HOLE)
for side,names in enumerate([left,right]):
 for i,name in enumerate(names):
  pad=k.PAD(fp);pad.SetNumber(str(1+i+15*side));pad.SetAttribute(k.PAD_ATTRIB_PTH);pad.SetShape(k.PAD_SHAPE_RECT if i==0 else k.PAD_SHAPE_OVAL);pad.SetSize(pos(1.8,1.8));pad.SetDrillSize(pos(1,1));pad.SetLayerSet(layers(k.F_Cu,k.B_Cu,k.F_Mask,k.B_Mask));pad.SetPosition(pos(side*P['row_spacing_mm'],i*P['pitch_mm']));fp.Add(pad)
def fpLine(a,b,layer,width=.12):
 line=k.PCB_SHAPE();line.SetShape(k.SHAPE_T_SEGMENT);line.SetStart(pos(*a));line.SetEnd(pos(*b));line.SetLayer(layer);line.SetWidth(mm(width));fp.Add(line)
for x in [0,P['row_spacing_mm']]:
 for a,b in [((x-1.5,-1.5),(x+1.5,-1.5)),((x+1.5,-1.5),(x+1.5,37.06)),((x+1.5,37.06),(x-1.5,37.06)),((x-1.5,37.06),(x-1.5,-1.5))]:fpLine(a,b,k.F_SilkS)
 for a,b in [((x-1.8,-1.8),(x+1.8,-1.8)),((x+1.8,-1.8),(x+1.8,37.36)),((x+1.8,37.36),(x-1.8,37.36)),((x-1.8,37.36),(x-1.8,-1.8))]:fpLine(a,b,k.F_CrtYd,.05)
# Body and antenna are on fabrication/user layers, not copper or courtyard.
for a,b in [((-2.5,-10),(P['row_spacing_mm']+2.5,-10)),((P['row_spacing_mm']+2.5,-10),(P['row_spacing_mm']+2.5,44)),((P['row_spacing_mm']+2.5,44),(-2.5,44)),((-2.5,44),(-2.5,-10))]:fpLine(a,b,k.F_Fab,.1)
fp.Reference().SetPosition(pos(P['row_spacing_mm']/2,18));fp.Reference().SetTextSize(pos(1.1,1.1));fp.Value().SetVisible(False)
k.PCB_IO_KICAD_SEXPR().FootprintSave(str(ROOT/'aquasense.pretty'),fp)
# Custom symbol: all unused pins will receive explicit no-connect markers.
def effects(size=1.0):return f'(effects (font (size {size} {size})))'
body=''
for side,names in enumerate([left,right]):
 for i,name in enumerate(names):
  number=1+i+side*15;x=-17.78 if side==0 else 17.78;y=17.78-i*2.54;angle=0 if side==0 else 180
  typ='power_out' if number in [15,30] else 'power_in' if number in [14,29] else 'input' if number in [4,5] else 'bidirectional'
  body+=f'(pin {typ} line (at {x} {y:.3f} {angle})(length 5.08)(name {q(name)} {effects(.8)})(number {q(number)} {effects(.8)}))'
custom=f'(symbol "ESP32_DevKit_30" (pin_names (offset 0.5))(in_bom yes)(on_board yes)(property "Reference" "U" (at 0 23 0){effects()})(property "Value" "ESP32 DevKit 30" (at 0 21 0){effects()})(property "Footprint" "aquasense:ESP32_DevKit_30" (at 0 0 0){effects()}(hide yes))(symbol "ESP32_DevKit_30_0_1" (rectangle (start -12.7 20.32)(end 12.7 -20.32)(stroke (width .254)(type default))(fill (type background))))(symbol "ESP32_DevKit_30_1_1" {body}))'
(ROOT/'aquasense.kicad_sym').write_text(f'(kicad_symbol_lib (version 20231120)(generator kicad_symbol_editor){custom})')
(ROOT/'sym-lib-table').write_text('(sym_lib_table (lib (name "aquasense")(type "KiCad")(uri "${KIPRJMOD}/aquasense.kicad_sym")(options "")(descr "ESP32 DevKit carrier")))\n')
(ROOT/'fp-lib-table').write_text('(fp_lib_table (lib (name "aquasense")(type "KiCad")(uri "${KIPRJMOD}/aquasense.pretty")(options "")(descr "Measured 30-pin socket carrier")))\n')
# Embed the exact KiCad standard symbol definitions in the schematic.
libs={};symbols={}
for c in components:
 lib,name=c['symbol'].split(':')
 if c['symbol'] in symbols:continue
 if lib=='aquasense':sym=sx.loads(custom)
 else:
  if lib not in libs:libs[lib]=sx.loads(Path('/usr/share/kicad/symbols/'+lib+'.kicad_sym').read_text())
  sym=copy.deepcopy(next(x for x in libs[lib] if tag(x,'symbol') and x[1]==name))
 sym[1]=c['symbol'];symbols[c['symbol']]=sym
# Native .kicad_sch, using labelled net stubs to keep sections readable.
rootid=uid('schematic');parts=[]
def flattenpins(sym):
 return [pin for sub in sym if tag(sub,'symbol') for pin in sub if tag(pin,'pin')]
positions={'U1':(65,87),'J1':(125,40),'R1':(153,43),'J2':(125,86),'R2':(155,80),'R3':(185,80),'C3':(215,80),'J3':(125,130),'R4':(155,124),'R5':(185,124),'C4':(215,124),'J4':(125,177),'R6':(155,174),'D1':(185,174),'F1':(65,155),'C1':(65,188),'C2':(92,188),'C5':(250,188),'C6':(280,188)}
for i in range(1,7):positions['TP'+str(i)]=(250+(i-1)%3*35,45+(i-1)//3*32)
for i in range(1,5):positions['H'+str(i)]=(250+(i-1)*25,135)
for c in components:
 x,y=positions[c['ref']];x=round(x/1.27)*1.27;y=round(y/1.27)*1.27;sym=symbols[c['symbol']]
 props=f'(property "Reference" {q(c["ref"])}(at {x+3} {y-5} 0){effects()})(property "Value" {q(c["value"])}(at {x+3} {y-2.5} 0){effects(.9)})(property "Footprint" {q(c["fp"])}(at {x} {y} 0){effects()}(hide yes))'
 pins=flattenpins(sym)
 pinids=''.join(f'(pin {q(one(pin,"number")[1])}(uuid {q(uid(c["ref"]+"pin"+one(pin,"number")[1]))}))' for pin in pins)
 parts.append(f'(symbol (lib_id {q(c["symbol"])})(at {x} {y} 0)(unit 1)(in_bom yes)(on_board yes)(dnp no)(uuid {q(c["uuid"])}){props}{pinids}(instances(project "aquasense-v1"(path "/{rootid}"(reference {q(c["ref"])})(unit 1)))))')
 for pin in pins:
  n=str(one(pin,'number')[1]);at=one(pin,'at');px=x+float(at[1]);py=y-float(at[2]);net=c['nets'].get(n)
  if net is None:parts.append(f'(no_connect (at {px:.4f} {py:.4f})(uuid {q(uid(c["ref"]+n+"nc"))}))');continue
  angle=float(at[3]);dx=-2.54*round(math.cos(math.radians(angle)));dy=2.54*round(math.sin(math.radians(angle)));ex=px+dx;ey=py+dy
  parts.append(f'(wire(pts(xy {px:.4f} {py:.4f})(xy {ex:.4f} {ey:.4f}))(stroke(width 0)(type default))(uuid {q(uid(c["ref"]+n+"wire"))}))')
  parts.append(f'(label {q(net)}(at {ex:.4f} {ey:.4f} 0){effects(.9)}(uuid {q(uid(c["ref"]+n+"label"))}))')
# GND driven by USB ground. Power outputs at U1 explicitly model USB VIN and regulator.
flag=copy.deepcopy(next(x for x in sx.loads(Path('/usr/share/kicad/symbols/power.kicad_sym').read_text()) if tag(x,'symbol') and x[1]=='PWR_FLAG'));flag[1]='power:PWR_FLAG';symbols['power:PWR_FLAG']=flag
parts.append(f'(symbol(lib_id "power:PWR_FLAG")(at 91.44 154.94 0)(unit 1)(in_bom yes)(on_board yes)(uuid {q(uid("gnd-flag"))})(property "Reference" "#FLG01"(at 91.44 151.13 0){effects()}(hide yes))(property "Value" "PWR_FLAG"(at 91.44 152.4 0){effects()})(instances(project "aquasense-v1"(path "/{rootid}"(reference "#FLG01")(unit 1)))))')
parts.append(f'(label "GND"(at 91.44 154.94 0){effects()}(uuid {q(uid("gnd-flag-label"))}))')
for text,x,y in [('AquaSense v1.0 - ESP32 carrier / USB power only',32,19),('USB VIN -> F1 -> protected +5V sensor rail',32,145),('J1 JST-XH: VDD GND DQ / 3.3V / 4.7k pull-up',115,26),('J2 JST-XH: PO G G V+ / 10k + 10k divider',115,65),('J3 JST-XH: VCC OUT GND / 10k + 10k divider',115,109),('J4 JST-XH: VCC OUT GND / optional PIR',115,158),('Test points',245,26),('NO direct PH_OUT / TURB_OUT connection to ESP32.',32,222),('All XH latches face left; verify module labels before plugging.',32,226),('Socket centres measured 25.4mm on physical board 18/11/2026.',32,230)]:
 parts.append(f'(text {q(text)}(at {x} {y} 0){effects(1.3)}(uuid {q(uid(text))}))')
schema=f'(kicad_sch(version 20250114)(generator "eeschema")(uuid {q(rootid)})(paper "A3")(title_block(title "AquaSense v1.0 - carrier board")(rev "1.0")(company "DATN 2026"))(lib_symbols '+''.join(sx.dumps(s) for s in symbols.values())+')'+''.join(parts)+')'
(ROOT/'aquasense-v1.kicad_sch').write_text(schema)
# Board and standard footprints.
b=k.BOARD();b.SetCopperLayerCount(2);settings=b.GetDesignSettings();settings.SetBoardThickness(mm(1.6));settings.m_MinClearance=mm(.2);settings.m_TrackMinWidth=mm(.2);settings.m_ViasMinSize=mm(.6);settings.m_MinThroughDrill=mm(.3);settings.m_HoleToHoleMin=mm(.25)
names=sorted({n for c in components for n in c['nets'].values()});nets={}
for name in names:n=k.NETINFO_ITEM(b,name);b.Add(n);nets[name]=n
fps={}
for c in components:
 lib,name=c['fp'].split(':');folder=ROOT/'aquasense.pretty' if lib=='aquasense' else Path('/usr/share/kicad/footprints')/(lib+'.pretty')
 f=k.PCB_IO_KICAD_SEXPR().FootprintLoad(str(folder),name)
 if f is None:raise RuntimeError(c['fp'])
 f.SetReference(c['ref']);f.SetValue(c['value']);f.SetFPID(k.LIB_ID(lib,name));f.SetPath(k.KIID_PATH('/'+rootid+'/'+c['uuid']));f.SetPosition(pos(c['x'],c['y']));f.SetOrientationDegrees(c['angle']);b.Add(f);fps[c['ref']]=f
 for pad in f.Pads():
  n=c['nets'].get(pad.GetNumber())
  if n:pad.SetNet(nets[n])
 f.Value().SetVisible(False);f.Reference().SetTextSize(pos(.85,.85));f.Reference().SetTextThickness(mm(.13))
for a,z in [((0,5),(80,5)),((80,5),(80,65)),((80,65),(0,65)),((0,65),(0,5))]:
 line=k.PCB_SHAPE();line.SetShape(k.SHAPE_T_SEGMENT);line.SetStart(pos(*a));line.SetEnd(pos(*z));line.SetLayer(k.Edge_Cuts);line.SetWidth(mm(.05));b.Add(line)
# Antenna copper exclusion on BOTH copper layers, including tracks/vias/pads.
keep=(P['header_x_mm']-3,5,P['header_x_mm']+P['row_spacing_mm']+3.6,18)
area=k.ZONE(b);area.SetIsRuleArea(True);area.SetLayerSet(layers(k.F_Cu,k.B_Cu));area.SetDoNotAllowTracks(True);area.SetDoNotAllowVias(True);area.SetDoNotAllowPads(True);area.SetDoNotAllowCopperPour(True);area.SetDoNotAllowFootprints(False);area.SetZoneName('ANTENNA - NO COPPER BOTH LAYERS')
poly=area.Outline();poly.NewOutline()
for xy in [(keep[0],keep[1]),(keep[2],keep[1]),(keep[2],keep[3]),(keep[0],keep[3])]:poly.Append(mm(xy[0]),mm(xy[1]))
b.Add(area)
def text(t,x,y,size=.9,layer=k.F_SilkS):
 item=k.PCB_TEXT(b);item.SetText(t);item.SetPosition(pos(x,y));item.SetTextSize(pos(max(.8,size),max(.8,size)));item.SetTextThickness(mm(.13));item.SetLayer(layer);b.Add(item)
text('AquaSense v1.0 - DATN 2026',44,62,1.05);text('ANTENNA / NO COPPER',48,9,.9);text('USB BELOW v',47.7,60,.9)
for label,x,y in [('JST-XH / LATCH LEFT',18,6.8),('J2 PH-4502C',18,16),('J3 MJKDZ',18,27.5),('J1 DS18B20',18,38.5),('J4 HC-SR501',18,49.5)]:text(label,x,y,.75)
for c in components:
 if c['ref'].startswith('TP'):text(c['value'],c['x']+3,c['y'],.7)
# Save an unrouted board before routing; router reads this in a separate script.
k.SaveBoard(str(ROOT/'aquasense-v1.kicad_pcb'),b)
project={'meta':{'filename':'aquasense-v1.kicad_pro','version':1},'board':{'design_settings':{'rules':{'min_clearance':.2,'min_track_width':.2,'min_via_diameter':.6,'min_through_hole_diameter':.3,'min_hole_to_hole':.25,'min_copper_edge_clearance':.3}}},'net_settings':{'classes':[{'name':'Default','clearance':.2,'track_width':.3,'via_diameter':.6,'via_drill':.3,'microvia_diameter':.3,'microvia_drill':.1},{'name':'Power','clearance':.2,'track_width':.7,'via_diameter':.8,'via_drill':.4,'microvia_diameter':.3,'microvia_drill':.1}],'netclass_assignments':{'+5V_RAW':'Power','+5V':'Power','+3V3':'Power','GND':'Power'}},'schematic':{}}
(ROOT/'aquasense-v1.kicad_pro').write_text(json.dumps(project,indent=2)+'\n')
with (ROOT/'bom.csv').open('w',newline='',encoding='utf-8-sig') as file:
 writer=csv.writer(file);writer.writerow(['Ref','Value','Footprint','Qty','Ghi chú'])
 for c in components:writer.writerow([c['ref'],'2x female socket 1x15 2.54mm (one set)' if c['ref']=='U1' else c['value'],c['fp'],1,(c['note']+'; buy 2 sockets; ESP32 module supplied separately') if c['ref']=='U1' else c['note']])
(ROOT/'design-manifest.json').write_text(json.dumps({'parameters':P,'components':components,'antenna_keepout':keep,'expected_nets':{c['ref']:c['nets'] for c in components}},indent=2)+'\n')
print('Generated',len(components),'components; board 80x60mm')
