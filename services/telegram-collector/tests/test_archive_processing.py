import asyncio, importlib.util, os, tempfile, time, json, subprocess
from pathlib import Path
from unittest.mock import patch
os.environ['ARCHIVE_SIGNING_KEY']='test-signing-key-only'
spec=importlib.util.spec_from_file_location('archive_worker',str(Path(__file__).resolve().parents[1]/'archive_worker.py'))
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

def ff(*args):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)

async def main():
  with tempfile.TemporaryDirectory() as temp:
    w.ROOT=Path(temp)
    source=Path(temp)/'source.mp4'
    ff('-f','lavfi','-i','testsrc2=size=320x240:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-c:a','aac',str(source))
    async def edge(job,payload):return {'streamUrl':str(source)}
    original_chunks=w.chunks
    original_process=w.process
    async def local_process(args,job,timeout=None):
      args=[v.replace('https,http,tls,tcp,crypto','file,https,http,tls,tcp,crypto') for v in args]
      if '-allowed_extensions' in args:
        at=args.index('-allowed_extensions');del args[at:at+2]
      return await original_process(args,job,timeout)
    job={'id':'test-concat','user':'a','headers':{},'state':'queued','quality':'source','profile':'auto','clips':[{'cameraId':'100-test:0','start':100,'end':104,'name':'Доказательство'}],'files':[],'created':time.time()}
    with patch.object(w,'process',local_process),patch.object(w,'edge',edge),patch.object(w,'media_url',lambda x:x),patch.object(w,'chunks',lambda a,b:original_chunks(a,b,2)):
      await w.run(job)
    assert job['state']=='ready',job
    duration,rate,width,height=await w.probe(job['files'][0]['path'],job)
    assert abs(duration-4)<.3,(duration,job)
    assert width==320 and height==240
    assert Path(job['files'][0]['path']).stat().st_size>1000
    assert list(original_chunks(100,3701,900))==[(100,1000),(1000,1900),(1900,2800),(2800,3700),(3700,3701)]
    assert w.clean_name('../test:camera')=='_test_camera'
    try:w.owned(job['id'],'b');raise AssertionError('cross owner')
    except w.HTTPException as error:assert error.status_code==404
    broken={**job,'id':'test-short-source','state':'queued','clips':[{'cameraId':'100-test:0','start':100,'end':105,'name':'Gap'}],'files':[]}
    with patch.object(w,'process',local_process),patch.object(w,'edge',edge),patch.object(w,'media_url',lambda x:x):
      await w.run(broken)
    assert broken['state']=='failed' and not broken['files'],broken
    print(json.dumps({'concat':True,'duration':duration,'fps':rate,'downloadBytes':Path(job['files'][0]['path']).stat().st_size}))
asyncio.run(main())
