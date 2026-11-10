"""Merge updates from the five embedded source repositories, retaining portal adaptations.
No game source or game destination is accepted. Conflicts leave the entire tree unchanged.
"""
import argparse, io, json, pathlib, subprocess, tempfile, urllib.request, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'data/embedded-sources.json'
ALLOW={'edholod/wb-qr-generotor','edholod/wb-pvz-academy','edholod/wb-ege','edholod/pvz-control'}
DEST={'qr','finance','rating','academy','ege','control'}
def archive(repo,ref):
    req=urllib.request.Request(f'https://codeload.github.com/{repo}/zip/{ref}',headers={'User-Agent':'EdPVZ-source-sync'})
    with urllib.request.urlopen(req,timeout=60) as r:z=zipfile.ZipFile(io.BytesIO(r.read()))
    return {'/'.join(pathlib.PurePosixPath(p).parts[1:]):z.read(p) for p in z.namelist() if not p.endswith('/')}
def head(repo):
    req=urllib.request.Request(f'https://api.github.com/repos/{repo}/commits/main',headers={'User-Agent':'EdPVZ-source-sync','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)['sha']
def merge(local,base,incoming):
    if local==base or local==incoming:return incoming
    if incoming==base:return local
    if b'\0' in local+base+incoming:raise ValueError('binary conflict')
    with tempfile.TemporaryDirectory() as d:
        paths=[pathlib.Path(d)/n for n in ('portal','base','incoming')]
        for p,b in zip(paths,(local,base,incoming)):p.write_bytes(b)
        r=subprocess.run(['git','merge-file','-p',*map(str,paths)],capture_output=True)
        if r.returncode:raise ValueError('overlapping portal and source edits')
        return r.stdout

def run(apply=False):
    manifest=json.loads(MANIFEST.read_text());planned={};conflicts=[];changes=[]
    for spec in manifest['sources']:
        repo=spec['repo']
        if repo not in ALLOW:raise ValueError('Source outside embedded allowlist')
        latest=head(repo);base=archive(repo,spec['revision']);incoming=base if latest==spec['revision'] else archive(repo,latest)
        for source,target in spec['files'].items():
            parts=pathlib.PurePosixPath(target).parts
            if len(parts)<3 or parts[0]!='apps' or parts[1] not in DEST or '..' in parts:raise ValueError('Destination outside embedded allowlist')
            local=(ROOT/target).read_bytes()
            if source not in incoming:
                conflicts.append(target+': source removed; portal file retained');continue
            try:result=merge(local,base[source],incoming[source])
            except (ValueError,KeyError) as e:conflicts.append(target+': '+str(e));continue
            if result!=local:planned[target]=result;changes.append(target)
        spec['revision']=latest
        print(repo+': checked '+str(len(spec['files']))+' mapped files')
    if conflicts:raise RuntimeError('No files were changed. Manual merge required:\n'+'\n'.join(conflicts))
    if apply:
        for target,data in planned.items():(ROOT/target).write_bytes(data)
        MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(('Applied' if apply else 'Ready')+': '+str(len(changes))+' source updates; portal customizations retained.')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');run(parser.parse_args().apply)
