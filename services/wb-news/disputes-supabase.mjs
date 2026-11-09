// Private Supabase transport. Never expose SUPABASE_SERVICE_ROLE_KEY in GitHub Pages.
// No WB rows are published unless an explicit WB event ID and a verified point ID exist.
const endpoint=process.env.SUPABASE_URL;
export const syncConfigured=()=>Boolean(endpoint&&process.env.EDPVZ_INGEST_TOKEN);
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

export async function sessionEnvelope(method,envelope){
 const token=process.env.EDPVZ_INGEST_TOKEN;
 if(!endpoint||!token)return {ok:false,reason:'credentials_not_configured'};
 const response=await fetch(new URL('/functions/v1/edpvz-disputes-ingest',endpoint),{
  method,headers:{'Content-Type':'application/json','x-edpvz-ingest-token':token},
  ...(method==='POST'?{body:JSON.stringify({kind:'encrypted_session',envelope})}:{}),
  signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('session_storage_'+response.status);
 return response.json();
}
