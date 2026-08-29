#!/usr/bin/env python3
"""Rebuild dist/experion-station-sim-standalone.html from the source files.

The standalone is the app template plus a manifest of gzip+base64 blobs
(support.js, every local <script src="./src/*.js"> module, and the React UMD
builds carried over from the previous dist). The bootstrap script and the
React blobs are reused verbatim from the existing dist.
"""
import base64, gzip, json, re, sys, uuid, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / 'Experion Station Simulator.dc.html'
DIST = ROOT / 'dist' / 'experion-station-sim-standalone.html'
NS = uuid.UUID('6f2d1b2e-4c3a-4e8f-9b1d-7a5c3e2f1a0b')

def blob(text):
    return base64.b64encode(gzip.compress(text.encode('utf-8'), mtime=0)).decode('ascii')

def main():
    old = DIST.read_text(encoding='utf-8')
    m_man = re.search(r'<script type="__bundler/manifest">(.*?)</script>', old, re.S)
    m_tpl = re.search(r'<script type="__bundler/template">(.*?)</script>', old, re.S)
    m_ext = re.search(r'<script type="__bundler/ext_resources">(.*?)</script>', old, re.S)
    if not (m_man and m_tpl and m_ext):
        sys.exit('existing dist is missing bundler blocks')
    manifest = json.loads(m_man.group(1))
    ext = json.loads(m_ext.group(1))
    keep = {e['uuid']: manifest[e['uuid']] for e in ext if e['uuid'] in manifest}

    app = APP.read_text(encoding='utf-8')
    new_manifest = dict(keep)
    def swap(m):
        src = m.group(1)
        path = (ROOT / src).resolve() if src.startswith('./') else None
        if path is None or not path.exists():
            sys.exit(f'local script not found: {src}')
        uid = str(uuid.uuid5(NS, src))
        new_manifest[uid] = {'mime': 'text/javascript', 'compressed': True, 'data': blob(path.read_text(encoding='utf-8'))}
        print(f'  {src} -> {uid} ({path.stat().st_size} bytes)')
        return m.group(0).replace(src, uid)
    template = re.sub(r'<script src="(\./[^"]+)"', swap, app)

    out = old[:m_man.start(1)] + json.dumps(new_manifest, separators=(',', ':')) + old[m_man.end(1):]
    # recompute template span in the new string
    m_tpl2 = re.search(r'<script type="__bundler/template">(.*?)</script>', out, re.S)
    tpl_json = json.dumps(template, ensure_ascii=False).replace('</', '<\\/')
    out = out[:m_tpl2.start(1)] + tpl_json + out[m_tpl2.end(1):]
    DIST.write_text(out, encoding='utf-8')
    print(f'wrote {DIST.relative_to(ROOT)} ({len(out.encode("utf-8"))} bytes, {len(new_manifest)} manifest entries)')

if __name__ == '__main__':
    main()
