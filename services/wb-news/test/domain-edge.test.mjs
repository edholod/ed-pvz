import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const paths=['../disputes-ingest.ts','../../edge/edpvz-register/index.ts','../../edge/edpvz-push-dispatch/index.ts','../../edge/pvz-control/index.ts'];
for(const path of paths)test('domain CORS isolates request origins: '+path,async()=>{
 const source=await readFile(new URL(path,import.meta.url),'utf8');
 const code=stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm,''),{mode:'strip'});
 let handler;
 vm.runInNewContext(code,{Deno:{env:{get:()=>''},serve:h=>handler=h},createClient:()=>({}),Response,Request,Headers,URL,TextEncoder,Uint8Array});
 const origins=['https://edholod.github.io','https://edpvz.ru','https://www.edpvz.ru','https://edpvz.ru.evil.example','http://edpvz.ru'];
 const responses=await Promise.all(origins.map(origin=>handler(new Request('https://example.test',{method:'OPTIONS',headers:{origin}}))));
 responses.forEach((response,i)=>{
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),i<3?origins[i]:null);
  assert.equal(response.headers.get('Vary'),'Origin');
  assert.ok(response.status<300);
 });
 if(path.includes('register')){
  const response=await handler(new Request('https://example.test',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}));
  assert.equal(response.status,403);
 }
});
