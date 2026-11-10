const exact=new Set(['edpvz-ui-settings-v1','edpvz-management-v1','edpvz-salary-v1','ed-pvz-ege-local-v1','ed-pvz-news-bookmarks-v1','edholod-pvz-economy-v2','pvz-control-active-key','wbpvz-demo-v18','wbpvz-portfolio-v134','wbpvz-daily-login-v138','wbpvz-time-boost-v141','wbpvz-collections-v145','wbpvz-profile-v146','wbpvz-privacy-v147','wbpvz-boost-earnings-v166','wbpvz-level-rewards-v167','wbpvz-bonuses-v173']);
export const MAX_BYTES=8*1024*1024;
export function allowedKey(key){return typeof key==='string'&&(exact.has(key)||/^wbacademy_[a-zA-Z0-9_-]{1,100}$/.test(key)||/^pvz-control-(?:v1|tg-[1-9][0-9]*)(?:-view|-damaged)?$/.test(key)||/^edpvz-dispute-drafts-v1:[a-f0-9-]{36}$/.test(key))}
export function validateBackup(input){
 if(!input||input.format!=='edpvz-local-transfer'||input.version!==1||!Array.isArray(input.entries)||input.entries.length>4000)throw Error('Неверный формат копии');
 if(new TextEncoder().encode(JSON.stringify(input)).length>MAX_BYTES)throw Error('Слишком большой файл');
 const seen=new Set();
 for(const item of input.entries){
  if(!item||!allowedKey(item.key)||typeof item.value!=='string'||seen.has(item.key))throw Error('Копия содержит неизвестные или повторяющиеся данные');
  seen.add(item.key);
 }
 return input;
}
export function makeBackup(storage,source){
 const entries=[];
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(allowedKey(key)){const value=storage.getItem(key);if(value!==null)entries.push({key,value})}}
 return validateBackup({format:'edpvz-local-transfer',version:1,createdAt:new Date().toISOString(),source,entries});
}
export function inspectBackup(storage,backup){
 validateBackup(backup);
 return backup.entries.map(item=>({...item,state:storage.getItem(item.key)===null?'new':storage.getItem(item.key)===item.value?'same':'conflict'}));
}
export function restoreBackup(storage,backup){
 const planned=inspectBackup(storage,backup).filter(item=>item.state==='new'),written=[];
 try{
  for(const item of planned){
   if(storage.getItem(item.key)!==null)continue;
   storage.setItem(item.key,item.value);written.push(item);
  }
 }catch(error){
  for(const item of written.reverse())if(storage.getItem(item.key)===item.value)storage.removeItem(item.key);
  throw Error('Не удалось сохранить копию. Проверьте свободное место. Существующие данные не заменялись.');
 }
 return {added:written.length,conflicts:inspectBackup(storage,backup).filter(item=>item.state==='conflict').length};
}
