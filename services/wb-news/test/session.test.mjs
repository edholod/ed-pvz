import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSession,decodeSession,encryptSession,decryptSession} from '../session.mjs';
const session={cookies:[{domain:'.wb.ru',name:'session',value:'synthetic-not-a-real-credential'}],origins:[{origin:'https://my-pvz.wb.ru',localStorage:[]}]};
test('WB session round trips without saving plaintext',()=>{const secret=encodeSession(session);assert.deepEqual(decodeSession(secret),session);const cipher=encryptSession(session,secret);assert.ok(!cipher.includes('synthetic-not-a-real-credential'));assert.deepEqual(decryptSession(cipher,secret),session)});
test('encrypted session rejects wrong secret and tampered ciphertext',()=>{const secret=encodeSession(session);const cipher=encryptSession(session,secret);assert.throws(()=>decryptSession(cipher,'wrong'));const value=JSON.parse(cipher);value.tag='AAAAAAAAAAAAAAAAAAAAAA==';assert.throws(()=>decryptSession(JSON.stringify(value),secret))});
test('export strips unrelated account domains and rejects malformed payloads',()=>{const result=decodeSession(encodeSession({...session,cookies:[...session.cookies,{domain:'.example.com',name:'other',value:'private'}]}));assert.equal(result.cookies.length,1);assert.throws(()=>decodeSession('not-session'));assert.throws(()=>decodeSession('A'.repeat(45001)))});
