#!/usr/bin/env python3
"""Rebuild AquaSense v1 from scripts and fail on any ERC/DRC violation."""
from pathlib import Path
import subprocess,sys

ROOT=Path(__file__).resolve().parent
def run(*args):
 print('+',' '.join(map(str,args)),flush=True)
 subprocess.run([str(a) for a in args],cwd=ROOT,check=True)

for script in ('generate.py','route.py','polish.py','finish_schematic.py'):
 run(sys.executable,script)
run('kicad-cli','sch','export','netlist','--output','reports/netlist.net','aquasense-v1.kicad_sch')
run(sys.executable,'verify.py')
run('kicad-cli','sch','erc','--severity-all','--exit-code-violations',
    '--output','reports/erc.rpt','aquasense-v1.kicad_sch')
run('kicad-cli','pcb','drc','--schematic-parity','--severity-all','--exit-code-violations',
    '--output','reports/drc.rpt','aquasense-v1.kicad_pcb')
run(sys.executable,'fabricate.py')
print('AquaSense v1 pipeline complete: ERC/DRC passed and fabrication outputs refreshed.')
