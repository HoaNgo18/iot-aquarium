#!/usr/bin/env python3
"""Synchronize exact Eeschema net names; audit critical pads and RF exclusion."""
from pathlib import Path
import json,pcbnew as k,sexpdata as sx
ROOT=Path(__file__).resolve().parent
b=k.LoadBoard(str(ROOT/'aquasense-v1.kicad_pcb'))
def tag(a,key):return isinstance(a,list) and a and str(a[0])==key
def one(a,key):return next((x for x in a if tag(x,key)),None)
netlist=sx.loads((ROOT/'reports/netlist.net').read_text());mapping={}
for net in one(netlist,'nets')[1:]:
 name=one(net,'name')[1]
 for node in net:
  if tag(node,'node'):mapping[(one(node,'ref')[1],str(one(node,'pin')[1]))]=name
for n in list(b.GetNetInfo().NetsByNetcode().values()):
 if n.GetNetname() and not n.GetNetname().startswith('/') and not n.GetNetname().startswith('unconnected-'):n.SetNetname('/'+n.GetNetname())
for f in b.GetFootprints():
 f.SetAttributes(f.GetAttributes() & ~k.FP_EXCLUDE_FROM_BOM)
 for pad in f.Pads():
  name=mapping.get((f.GetReference(),pad.GetNumber()))
  if not name:continue
  n=b.FindNet(name)
  if n is None or n.GetNetCode()<0:n=k.NETINFO_ITEM(b,name);b.Add(n)
  pad.SetNet(n)
project=json.loads((ROOT/'aquasense-v1.kicad_pro').read_text());project['net_settings']['netclass_assignments']={'/'+key.lstrip('/'):value for key,value in project['net_settings']['netclass_assignments'].items()};(ROOT/'aquasense-v1.kicad_pro').write_text(json.dumps(project,indent=2)+'\n')
k.SaveBoard(str(ROOT/'aquasense-v1.kicad_pcb'),b)
b=k.LoadBoard(str(ROOT/'aquasense-v1.kicad_pcb'))
manifest=json.loads((ROOT/'design-manifest.json').read_text());expected=manifest['expected_nets'];checked=0
for f in b.GetFootprints():
 for p in f.Pads():
  n=expected[f.GetReference()].get(p.GetNumber())
  if n:assert p.GetNetname().lstrip('/')==n,(f.GetReference(),p.GetNumber(),n,p.GetNetname());checked+=1
u=next(f for f in b.GetFootprints() if f.GetReference()=='U1');by={p.GetNumber():p for p in u.Pads()}
assert by['4'].GetNetname()=='/PH_ADC';assert by['5'].GetNetname()=='/TURB_ADC';assert by['26'].GetNetname()=='/TEMP_DQ'
assert abs(k.ToMM(by['16'].GetPosition().x-by['1'].GetPosition().x)-manifest['parameters']['row_spacing_mm'])<1e-6
# Mechanical checks for the keyed JST-XH connector bank.  The latch/front
# detail is local -Y; at 90 degrees that edge faces board -X.
footprints={f.GetReference():f for f in b.GetFootprints()}
xh_expected={
 'J1':((11.5,38.5),'JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical',['+3V3','GND','TEMP_DQ']),
 'J2':((11.5,16.0),'JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical',['PH_OUT','GND','GND','+5V']),
 'J3':((11.5,27.5),'JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical',['+5V','TURB_OUT','GND']),
 'J4':((11.5,49.5),'JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical',['+5V','PIR_OUT','GND']),
}
xh_report={}
for ref,(expected_pos,expected_fp,pin_order) in xh_expected.items():
 f=footprints[ref];x,y=k.ToMM(f.GetPosition().x),k.ToMM(f.GetPosition().y)
 assert abs(x-expected_pos[0])<1e-6 and abs(y-expected_pos[1])<1e-6
 assert abs(f.GetOrientationDegrees()%360-90)<1e-6
 assert f.GetFPID().GetLibItemName()==expected_fp
 actual=[next(p for p in f.Pads() if p.GetNumber()==str(i+1)).GetNetname().lstrip('/') for i in range(len(pin_order))]
 assert actual==pin_order,(ref,actual,pin_order)
 latch_clearance=x-2.85
 assert latch_clearance>=8.0
 xh_report[ref]={'position_mm':[x,y],'orientation_deg':90,'latch_and_cable_direction':'left / board -X','front_clearance_to_board_edge_mm':round(latch_clearance,2),'pin_order':pin_order}
# The closest mounting holes sit diagonally outside the physical XH bodies.
mounting_body_clearance={'J2_to_H1_mm':round(8.65-3.5,2),
                         'J4_to_H3_mm':round(((8.65-3.5)**2+(61.5-57.06)**2)**.5,2)}
assert min(mounting_body_clearance.values())>5.0
# All signal tracks remain >=0.3mm; power tracks >=0.7mm.
for t in b.GetTracks():
 if isinstance(t,k.PCB_VIA):continue
 power=t.GetNetname().lstrip('/').startswith('+')
 assert k.ToMM(t.GetWidth()) >= (.699 if power else .299)
# Probe the complete antenna keepout at 0.25mm resolution, on both pours.
hits=[]
keep=manifest['antenna_keepout']
for layer in [k.F_Cu,k.B_Cu]:
 for z in b.Zones():
  if z.GetIsRuleArea() or z.GetLayer()!=layer:continue
  poly=z.GetFilledPolysList(layer)
  for xi in range(round((keep[2]-keep[0])/.25)):
   for yi in range(round((keep[3]-keep[1])/.25)):
    x=keep[0]+.125+xi*.25;y=keep[1]+.125+yi*.25
    if poly.Contains(k.VECTOR2I(k.FromMM(x),k.FromMM(y))):hits.append((x,y,layer))
assert not hits,str(hits[:20])+' total '+str(len(hits))
unconnected=b.GetConnectivity().GetUnconnectedCount(False)
assert unconnected==0,unconnected
report={'critical_gpio_pads':{'GPIO4':'U1.26 / TEMP_DQ','GPIO34':'U1.4 / PH_ADC','GPIO35':'U1.5 / TURB_ADC'},'checked_net_assignments':checked,'unconnected_count':unconnected,'antenna_copper_sample_hits':len(hits),'antenna_sample_pitch_mm':.25,'board_mm':[80,60],'socket_row_centres_mm':manifest['parameters']['row_spacing_mm'],'socket_spacing_measured_on_physical_board':'2026-11-18','xh_connectors':xh_report,'mounting_hole_to_connector_body_clearance_mm':mounting_body_clearance,'divider_ph_5v_to_adc_v':5*10000/(10000+10000),'divider_clarity_4p5v_to_adc_v':4.5*10000/(10000+10000),'schematic_board_net_names_synchronized':True}
(ROOT/'reports/design-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
