import asyncio,importlib.util,os,tempfile,time,json,subprocess,shutil
from pathlib import Path
from unittest.mock import patch
os.environ['ARCHIVE_SIGNING_KEY']='test-signing-key-only'
spec=importlib.util.spec_from_file_location('archive_worker',str(Path(__file__).resolve().parents[1]/'archive_worker.py'))
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
def ff(*args):subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*args],check=True)
async def main():
 with tempfile.TemporaryDirectory() as temp:
  w.ROOT=Path(temp);source=Path(temp)/'source.mp4'
  ff('-f','lavfi','-i','testsrc2=size=320x240:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-threads','1','-c:v','libx264','-c:a','aac',str(source))
  async def exported(job,clip,start,end):
   piece=Path(temp)/('export-'+str(start)+'-'+str(end)+'.mp4')
   ff('-ss',str(start-100),'-i',str(source),'-t',str(end-start),'-threads','1','-c:v','libx264','-c:a','aac',str(piece))
   return str(piece)
  async def received(url,path,job):shutil.copyfile(url,path);return str(path)
  original_chunks=w.chunks
  job={'id':'test-concat','user':'a','headers':{},'state':'queued','quality':'720','profile':'auto','clips':[{'cameraId':'100-test:0','start':100,'end':104,'name':'Доказательство'}],'files':[],'created':time.time()}
  with patch.object(w,'export_source',exported),patch.object(w,'download_source',received),patch.object(w,'chunks',lambda a,b:original_chunks(a,b,2)):
   await w.run(job)
  assert job['state']=='ready',job
  duration,rate,width,height=await w.probe(job['files'][0]['path'],job)
  assert abs(duration-4)<.05,(duration,job)
  info=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',job['files'][0]['path']]))
  assert int(info['streams'][0]['nb_read_frames'])==100,info
  assert (width,height)==(320,240)
  assert list(original_chunks(100,3701,900))==[(100,1000),(1000,1900),(1900,2800),(2800,3700),(3700,3701)]
  assert w.clean_name('../test:camera')=='_test_camera'
  try:w.owned(job['id'],'b');raise AssertionError('cross owner')
  except w.HTTPException as error:assert error.status_code==404
  broken={**job,'id':'test-short-source','state':'queued','clips':[{'cameraId':'100-test:0','start':100,'end':105,'name':'Gap'}],'files':[]}
  with patch.object(w,'export_source',exported),patch.object(w,'download_source',received):await w.run(broken)
  assert broken['state']=='failed' and not broken['files'],broken
  async def padded_export(job,clip,start,end):return str(source)
  shifted={**job,'id':'test-shifted-source','state':'queued','clips':[{'cameraId':'100-test:0','start':100,'end':102,'name':'Shifted'}],'files':[]}
  with patch.object(w,'export_source',padded_export),patch.object(w,'download_source',received):await w.run(shifted)
  assert shifted['state']=='failed' and not shifted['files'] and 'границами времени' in shifted['message'],shifted
  from fastapi import FastAPI
  from fastapi.testclient import TestClient
  app=FastAPI();app.include_router(w.router);w.JOBS[job['id']]=job
  async def owner(request):return ('a',{})
  with patch.object(w,'auth',owner),TestClient(app) as client:
   response=client.post('/archive/jobs/test-concat/file/0/frame',json={'second':1.5});assert response.status_code==200,response.text
   link=client.post('/archive/jobs/test-concat/file/'+response.json()['id'],json={}).json();jpeg=client.get(link['url'])
   assert jpeg.status_code==200 and jpeg.content.startswith(b'\xff\xd8') and jpeg.content.endswith(b'\xff\xd9')
  print(json.dumps({'concat':True,'duration':duration,'frames':100,'fps':rate,'downscaleWithoutUpscaling':True,'incompleteVideoRejected':True,'shiftedSourceRejected':True,'jpegDownload':True}))
asyncio.run(main())
