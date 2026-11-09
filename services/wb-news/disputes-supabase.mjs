// Private Supabase transport. Never expose SUPABASE_SERVICE_ROLE_KEY in GitHub Pages.
// No WB rows are published unless an explicit WB event ID and a verified point ID exist.
const endpoint=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
export const syncConfigured=()=>Boolean(endpoint&&process.env.EDPVZ_INGEST_TOKEN);
async function api(table,rows,conflict){
 if(!syncConfigured())return {ok:false,reason:'credentials_not_configured'};
 if(!rows.length)return {ok:true,count:0};
 const url=new URL('/rest/v1/'+table,endpoint);
 if(conflict)url.searchParams.set('on_conflict',conflict);
 const response=await fetch(url,{method:'POST',headers:{
  apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',
  Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('supabase_write_'+response.status);
 return {ok:true,count:rows.length};
}
export async function saveInspection(ownerId,inspection){
 const token=process.env.EDPVZ_INGEST_TOKEN;
 if(!endpoint||!token)return {ok:false,reason:'credentials_not_configured'};
 if(!Array.isArray(inspection.sections))return {ok:false,reason:'invalid_inspection'};
 const response=await fetch(new URL('/functions/v1/edpvz-disputes-ingest',endpoint),{
 method:'POST',headers:{'Content-Type':'application/json','x-edpvz-ingest-token':token},
 body:JSON.stringify({sections:inspection.sections.map(({key,state})=>({key,state}))}),
 signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('ingest_'+response.status);
 return await response.json();
}
export async function saveVerifiedObservations(ownerId,rows,pointOrganizations){
 if(!syncConfigured())return {ok:false,reason:'credentials_not_configured'};
 const safe=[];
 for(const row of rows){
  if(!row.source_event_id||!row.wb_point_id||!pointOrganizations[row.wb_point_id])continue;
  if(!['Брак','Подмена','Штраф','Зависший'].includes(row.category))continue;
  safe.push({owner_id:ownerId,organization_research_id:pointOrganizations[row.wb_point_id],
   wb_point_id:row.wb_point_id,category:row.category,source_namespace:row.source_namespace,
   source_event_id:row.source_event_id,barcode:row.barcode||null,title:row.title||null,
   amount:row.amount??null,observed_at:row.observed_at||new Date().toISOString(),
   provenance:'wb_browser_read_only',raw:{}});
 }
 return api('edpvz_dispute_observations',safe,'owner_id,source_namespace,source_event_id');
}
