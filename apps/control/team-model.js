/* Pure merge: team identity comes from approved memberships, never from display names. */
(()=>{
 'use strict';
 const stable=value=>{let n=2166136261;for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16)};
 const pointKey=value=>/^[a-zA-Z0-9_.:-]{1,85}$/.test(value)?'cloud-point:'+value:'cloud-point:'+stable(value);
 function merge(current,{points,members,cards,profiles}){
  const next=JSON.parse(JSON.stringify(current));
  const pointMap=new Map(),aliases=new Map();
  for(const remote of points){
   let p=next.points.find(p=>p.cloudPointId===remote.point_id||p.id===remote.point_id);
   if(!p){
    const matches=next.points.filter(q=>!q.cloudPointId&&q.name.trim().toLocaleLowerCase()===String(remote.name||'').trim().toLocaleLowerCase()&&q.market===(remote.market||'wb'));
    const remoteMatches=points.filter(q=>q.name===remote.name&&(q.market||'wb')===(remote.market||'wb'));
    if(matches.length===1&&remoteMatches.length===1)p=matches[0];
   }
   if(!p){p={id:pointKey(remote.point_id),name:(remote.name||'ПВЗ')+' · '+remote.point_id,market:remote.market||'wb'};next.points.push(p)}
   if(['wb','ozon','ym'].includes(remote.market))p.market=remote.market;
   p.cloudPointId=remote.point_id;pointMap.set(remote.point_id,p.id);
   // Older releases could create a cloud copy beside the existing local point.
   // Retain both records and their history, but make the confirmed team selectable in either view.
   const legacy=next.points.filter(q=>!q.cloudPointId&&q.market===p.market&&q.name.trim().toLocaleLowerCase()===String(remote.name||'').trim().toLocaleLowerCase());
   aliases.set(remote.point_id,legacy.length===1?[p.id,legacy[0].id]:[p.id]);
  }
  const groups=new Map();
  for(const m of members){if(m.status!=='approved'||!pointMap.has(m.point_id))continue;const group=groups.get(m.user_id)||[];group.push(m.point_id);groups.set(m.user_id,group)}
  for(const [uid,pointIds] of groups){
   const profile=profiles.find(p=>p.user_id===uid),card=cards.find(c=>c.user_id===uid&&pointIds.includes(c.point_id)&&c.full_name?.trim());
   let person=next.people.find(p=>p.cloudUserId===uid);
   if(!person){person={id:'cloud-user:'+uid,name:card?.full_name?.trim()||profile?.username||'Сотрудник · '+uid.slice(0,8),role:profile?.role==='supervisor'?'manager':'employee',rate:0,hourlyRate:0,color:'#A6C8E7',archived:false,points:[]};next.people.push(person)}
   person.cloudUserId=uid;
   const previousCloud=new Set(person.cloudPoints||[]);
   // Preserve manual point assignments, salary rates, archives and existing shift identities.
   const assigned=pointIds.flatMap(p=>aliases.get(p)||[pointMap.get(p)]);
   person.points=[...new Set([...(person.points||[]).filter(p=>!previousCloud.has(p)||assigned.includes(p)),...assigned])];
   person.cloudPoints=assigned;person.cloudInactive=false;
   const label=card?.full_name?.trim()||profile?.username;
   if(label)person.name=label;
  }
  for(const person of next.people)if(person.cloudUserId&&!groups.has(person.cloudUserId))person.cloudInactive=true;
  return next;
 }
 async function load(api){
  async function all(query){const rows=[];for(let offset=0;;offset+=500){const page=await api.readTable(query+'&limit=500&offset='+offset);if(!Array.isArray(page))throw Error('Неверный ответ списка команды');rows.push(...page);if(page.length<500)return rows}}
  const [points,members,cards,profiles]=await Promise.all([
   all('edpvz_points?select=point_id,name,owner_id,market&order=point_id'),
   all('edpvz_memberships?status=eq.approved&select=point_id,user_id,status&order=point_id,user_id'),
   all('edpvz_staff_cards?select=point_id,user_id,full_name&order=point_id,user_id'),
   all('edpvz_profiles?select=user_id,username,role&order=user_id')
  ]);
  return {points,members,cards,profiles};
 }
 window.EdPVZCalendarTeam={merge,load};
})();
