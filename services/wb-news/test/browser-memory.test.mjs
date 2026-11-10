import test from 'node:test';import assert from 'node:assert/strict';
import {renewWBPage} from '../browser-memory.mjs';
test('renderer renewal closes the old tab before opening a replacement in the same context',async()=>{
 const calls=[];const fresh={setDefaultTimeout:ms=>calls.push(['timeout',ms])};
 const context={newPage:async()=>{calls.push('new');return fresh}};
 const old={context:()=>context,close:async()=>calls.push('close')};
 assert.equal(await renewWBPage(old),fresh);assert.deepEqual(calls,['close','new',['timeout',10000]]);
});
