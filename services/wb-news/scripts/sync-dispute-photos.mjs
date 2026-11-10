import{mkdir,writeFile,access,readdir}from'node:fs/promises';import{createHash}from'node:crypto';import{dirname,resolve}from'node:path';
const endpoint='https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-disputes-ingest?asset_manifest=1';
const response=await fetch(endpoint,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error('Photo manifest unavailable: '+response.status);const{photos}=await response.json();let saved=0,failed=0;
for(const item of photos){
 try{
 const source=new URL(item.url);if(source.protocol!=='https:'||!/(^|\.)(wbbasket\.ru|wb\.ru|wildberries\.ru)$/.test(source.hostname)||source.search||source.username)throw Error('Untrusted photo source');
 const extension=source.pathname.match(/\.(webp|png|jpe?g)$/)?.[1];if(!extension)throw Error('Unexpected image extension');const expected='assets/wb-disputes/'+createHash('sha256').update(item.url).digest('hex')+'.'+extension;if(item.path!==expected)throw Error('Photo path mismatch');
 const target=resolve(expected);try{await access(target);continue}catch{}
 const r=await fetch(item.url,{signal:AbortSignal.timeout(30000),redirect:'error'});if(!r.ok)throw Error('Image unavailable: '+r.status);if(!/^image\/(webp|jpeg|png)/.test(r.headers.get('content-type')||''))throw Error('Unexpected image type');if(Number(r.headers.get('content-length')||0)>8*1024*1024)throw Error('Image too large');const buffer=Buffer.from(await r.arrayBuffer());if(buffer.length>8*1024*1024)throw Error('Image too large');await mkdir(dirname(target),{recursive:true});await writeFile(target,buffer);saved++;
 }catch(error){failed++;console.error('Photo copy deferred:',String(error.message).slice(0,120))}
}
await mkdir('assets/wb-disputes',{recursive:true});
const files=(await readdir('assets/wb-disputes')).filter(name=>/^[a-f0-9]{64}\.(webp|png|jpe?g)$/.test(name)).sort();
await writeFile('assets/wb-disputes/index.json',JSON.stringify(files.map(name=>'assets/wb-disputes/'+name)));
console.log(JSON.stringify({photos:photos.length,saved,failed}));if(failed)process.exitCode=1;
