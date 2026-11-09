import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const owner='0f75065b-2b26-4a87-bf26-005f5a2284d4',origin='https://edholod.github.io';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-edpvz-ingest-token','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function rpc(payload){const {data,error}=await db.rpc('edpvz_dispute_sync_commit',{p:payload});if(error)throw Error(error.message);return data}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
 try{
  const token=req.headers.get('x-edpvz-ingest-token')||'';
  let machine=false;
  if(token.length>=32&&token.length<=1024){
   const {data:credential,error}=await db.from('edpvz_dispute_ingest_credentials').select('token_hash').eq('owner_id',owner).single();
   machine=!error&&credential&&await sha(token)===credential.token_hash;
  }
  if(!machine){
   // Owner JWT only permits requesting a run: no session export or data ingestion.
   const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
   if(!bearer)return json({error:'unauthorized'},401);
   const {data,error}=await db.auth.getUser(bearer);
   if(error||data.user?.id!==owner)return json({error:'forbidden'},403);
   if(req.method!=='POST'||req.headers.get('origin')!==origin)return json({error:'forbidden'},403);
   const body=await req.json();if(body.kind!=='request_sync')return json({error:'forbidden'},403);
   return json(await rpc({kind:'request'}),202);
  }
  if(req.method==='GET'){
   const [session,orgs,points,tickets,control]=await Promise.all([
    db.from('edpvz_wb_encrypted_sessions').select('envelope').eq('owner_id',owner).maybeSingle(),
    db.from('edpvz_dispute_organizations').select('research_id,name_exact').eq('owner_id',owner),
    db.from('edpvz_dispute_points').select('wb_point_id,organization_research_id,address_observed').eq('owner_id',owner),
    db.from('edpvz_dispute_tickets').select('organization_research_id,namespace,ticket_number,baseline_completed_at,last_checked_at,last_attempt_at,status').eq('owner_id',owner).limit(10000),
    db.from('edpvz_dispute_sync_control').select('next_due_at,last_state').eq('owner_id',owner).maybeSingle()
   ]);
   if([session,orgs,points,tickets,control].some(x=>x.error))return json({error:'database_read_failed'},500);
   return json({envelope:session.data?.envelope||null,registry:(orgs.data||[]).map(o=>({...o,points:(points.data||[]).filter(p=>p.organization_research_id===o.research_id)})),tickets:tickets.data||[],control:control.data});
  }
  if(Number(req.headers.get('content-length')||0)>5000000)return json({error:'payload_too_large'},413);
  const text=await req.text();if(text.length>5000000)return json({error:'payload_too_large'},413);
  let body;try{body=JSON.parse(text)}catch{return json({error:'invalid_json'},400)}
  if(body.kind==='encrypted_session'){
   if(typeof body.envelope!=='string'||body.envelope.length<40||body.envelope.length>150000)return json({error:'invalid_envelope'},400);
   let parsed;try{parsed=JSON.parse(body.envelope)}catch{return json({error:'invalid_envelope'},400)}
   if(parsed.version!==1||!parsed.nonce||!parsed.tag||!parsed.body)return json({error:'invalid_envelope'},400);
   const {error}=await db.from('edpvz_wb_encrypted_sessions').upsert({owner_id:owner,envelope:body.envelope,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
   return error?json({error:'database_write_failed'},500):json({ok:true,stored:true});
  }
  if(body.sections&&!body.kind)return json({ok:true,updated:0,compatibility:'inspection_only'});
  if(!['claim','scope','finish'].includes(body.kind)||!/^[-\w]{10,100}$/.test(body.worker||''))return json({error:'invalid_payload'},400);
  if(body.kind==='scope'){
   if(!Array.isArray(body.rows||[])||!Array.isArray(body.tickets||[])||(body.rows||[]).length>150||(body.tickets||[]).length>1)return json({error:'invalid_batch'},400);
   for(const row of body.rows||[]){
    if(!['Зависший','Брак','Подмена','Штраф'].includes(row.category)||!/^\d{4,40}$/.test(row.barcode||''))return json({error:'invalid_row'},400);
    if(row.photo_url&&!/^https:\/\/[^/?]+\.(wbbasket|wb|wildberries)\.ru\//.test(row.photo_url))return json({error:'invalid_image'},400);
   }
   for(const ticket of body.tickets||[]){
    if(!['legacy','new'].includes(ticket.namespace)||!/^\d{1,30}$/.test(ticket.ticket_number))return json({error:'invalid_ticket'},400);
    if(ticket.messages&&!Array.isArray(ticket.messages))return json({error:'invalid_messages'},400);
   }
  }
  return json(await rpc(body));
 }catch{return json({error:'sync_request_failed'},500)}
});
