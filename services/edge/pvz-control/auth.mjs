const enc = new TextEncoder();
export async function verifyTelegram(initData, token, now = Date.now()) {
 if (typeof initData !== 'string' || initData.length > 16000) throw Error('AUTH');
 const p = new URLSearchParams(initData), seen = new Set();
 for (const [key] of p) { if (seen.has(key)) throw Error('AUTH'); seen.add(key); }
 const hash = p.get('hash');
 if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw Error('AUTH');
 const date = Number(p.get('auth_date'));
 if (!Number.isInteger(date) || date > now / 1000 + 30 || now / 1000 - date > 86400) throw Error('AUTH_EXPIRED');
 p.delete('hash');
 const check = [...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const hmac = async (key, data) => {
  const k = await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(data)));
 };
 const secret = await hmac(enc.encode('WebAppData'), token);
 const actual = await hmac(secret, check);
 const expected = new Uint8Array(hash.match(/../g).map(x=>parseInt(x,16)));
 let diff=0; for(let i=0;i<32;i++) diff |= actual[i]^expected[i];
 if(diff) throw Error('AUTH');
 const user=JSON.parse(p.get('user') || 'null');
 if(!user || !Number.isSafeInteger(user.id) || user.id<=0) throw Error('AUTH');
 return user.id;
}
