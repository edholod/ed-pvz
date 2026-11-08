import {gzipSync, gunzipSync} from 'node:zlib';
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';

function wbHost(host) { return host === 'wb.ru' || host.endsWith('.wb.ru') || host === 'wildberries.ru' || host.endsWith('.wildberries.ru'); }
export function filterSession(state) {
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw Error('invalid_session');
  const cookies = state.cookies.filter(cookie => typeof cookie.domain === 'string' && wbHost(cookie.domain.replace(/^\./,'')));
  const origins = state.origins.filter(item => {try {const u=new URL(item.origin);return u.protocol==='https:'&&wbHost(u.hostname)}catch{return false}});
  return {cookies,origins};
}
export function encodeSession(state) {
  const encoded = gzipSync(Buffer.from(JSON.stringify(filterSession(state)))).toString('base64');
  if (encoded.length > 45000) throw Error('session_too_large');
  return encoded;
}
export function decodeSession(secret) {
  if (typeof secret !== 'string' || secret.length > 45000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(secret)) throw Error('invalid_session');
  const raw=gunzipSync(Buffer.from(secret.trim(),'base64'),{maxOutputLength:1000000});
  const session=filterSession(JSON.parse(raw));
  if (!session.cookies.length && !session.origins.some(o=>o.localStorage?.length)) throw Error('empty_session');
  return session;
}
function key(secret){return createHash('sha256').update('ed-pvz-wb-session-v1\0'+secret.trim()).digest()}
export function encryptSession(state,secret){
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),nonce);
  const body=Buffer.concat([cipher.update(JSON.stringify(filterSession(state)),'utf8'),cipher.final()]);
  return JSON.stringify({version:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});
}
export function decryptSession(envelope,secret){
  const value=JSON.parse(envelope);if(value.version!==1)throw Error('invalid_ciphertext');
  const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(value.nonce,'base64'));
  decipher.setAuthTag(Buffer.from(value.tag,'base64'));
  return filterSession(JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8')));
}
