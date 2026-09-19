# @artifact dev
"""Copy a pinned, self-contained simulator dependency into a separate artifact."""
from pathlib import Path
import hashlib,json,shutil,subprocess,sys
root=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1]).resolve()
out.mkdir(parents=True,exist_ok=True)
paths=[p for p in (root/'src').glob('*.js')]+[root/'tools/rt/kernel-worker.js',root/'Experion Station Simulator.dc.html',root/'support.js',root/'dist/experion-station-sim-standalone.html']
files={}
for p in paths:
 rel=p.relative_to(root); dest=out/rel; dest.parent.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(p,dest);files[str(rel)]=hashlib.sha256(dest.read_bytes()).hexdigest()
subprocess.run(['node',str(root/'tools/rt/prepare-initial.js'),str(out/'initial-checkpoint.json')],check=True)
for name in ['initial-checkpoint.json','initial-checkpoint.readiness.json']:
 files[name]=hashlib.sha256((out/name).read_bytes()).hexdigest()
manifest={'initial_checkpoint':'initial-checkpoint.json','protocol':'peb.kernel.v1','node_runtime':'.'.join(subprocess.check_output(['node','--version'],text=True).strip().lstrip('v').split('.')[:2]),'model_id':hashlib.sha256((root/'src/model-id.js').read_bytes()).hexdigest(),'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'files':files}
p=out/'manifest.json';p.write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n');print(p);print(hashlib.sha256(p.read_bytes()).hexdigest())
