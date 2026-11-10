// Private authenticated transport. Financial data never enters public feeds.
export const syncConfigured=()=>Boolean(process.env.SUPABASE_URL&&process.env.EDPVZ_INGEST_TOKEN);
export async function ingest(body){
 if(!syncConfigured())throw Error('credentials_not_configured');
 const response=await fetch(new URL('/functions/v1/edpvz-disputes-ingest',process.env.SUPABASE_URL),{
  method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-edpvz-ingest-token':process.env.EDPVZ_INGEST_TOKEN},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('ingest_'+response.status);return response.json();
}
export const sessionEnvelope=(method,envelope)=>ingest(method==='GET'?undefined:{kind:'encrypted_session',envelope});
export const saveInspection=(_owner,inspection)=>ingest({sections:(inspection.sections||[]).map(({key,state})=>({key,state}))});
export async function saveScope(batch,{worker,run_id}){
 const {rows=[],tickets=[],...rest}=batch;
 for(let offset=0;offset<rows.length;offset+=100)await ingest({...rest,kind:'scope',worker,run_id,complete:false,status:'running',rows:rows.slice(offset,offset+100)});
 let last;
 for(const ticket of tickets)last=await ingest({...rest,kind:'scope',worker,run_id,complete:false,status:'running',tickets:[ticket]});
 // The single-ticket write already checkpoints this running scope. Keep the
 // terminal empty request for completion, partial status and count validation.
 if(!rows.length&&tickets.length&&rest.complete===false&&rest.status==='running')return last;
 return ingest({...rest,kind:'scope',worker,run_id,rows:[],tickets:[]});
}

