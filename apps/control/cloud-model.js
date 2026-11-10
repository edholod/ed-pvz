(()=>{
 'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function merge(base,local,remote,path=''){
  if(same(local,remote)||same(base,remote))return {data:local,conflicts:[]};
  if(same(base,local))return {data:remote,conflicts:[]};
  if(Array.isArray(local)&&Array.isArray(remote)&&Array.isArray(base)&&[...base,...local,...remote].every(x=>x&&typeof x.id==='string')){
   const keys=[...new Set([...local,...remote,...base].map(x=>x.id))],data=[],conflicts=[];
   for(const id of keys){const result=merge(base.find(x=>x.id===id),local.find(x=>x.id===id),remote.find(x=>x.id===id),path+'/'+id);if(result.data!==undefined)data.push(result.data);conflicts.push(...result.conflicts)}
   return {data,conflicts};
  }
  if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)&&(base===undefined||base&&typeof base==='object'&&!Array.isArray(base))){
   const data={},conflicts=[];
   for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
    const result=merge(base?.[key],local[key],remote[key],path+'/'+key);if(result.data!==undefined)data[key]=result.data;conflicts.push(...result.conflicts);
   }
   return {data,conflicts};
  }
  return {data:local,conflicts:[path||'/']};
 }
 window.EdPVZCalendarCloud={merge,same};
})();
