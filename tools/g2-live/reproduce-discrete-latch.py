#!/usr/bin/env python3
# @artifact dev
"""Reproduce the preserved failed candidate in an isolated temporary tree."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

HERE=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    target=args.out.resolve()
    if target in ((HERE/'receipts/discrete-latch-v1.json').resolve(),(HERE/'receipts/live-v1.json').resolve()):
        raise ValueError('preserved evidence cannot be overwritten')
    archive=json.loads((HERE/'archives/discrete-latch-v1.json').read_text())
    with tempfile.TemporaryDirectory(prefix='g2-discrete-latch-') as tmp:
        root=Path(tmp).resolve()
        for name,item in archive['sources'].items():
            data=item['source'].encode()
            if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('archive hash mismatch '+name)
            path=root/name
            if not path.resolve().is_relative_to(root):raise ValueError('archive path escapes tree')
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        return subprocess.call([sys.executable,'-B',str(root/'tools/g2-live/reference.py'),'--out',str(target)],cwd=root)

if __name__=='__main__':raise SystemExit(main())
