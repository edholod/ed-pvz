import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { verifyTelegram } from './auth.mjs';
import { validate } from './validate.mjs';
const baseHeaders={'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const allowedOrigins=new Set(['https://edholod.github.io','https://edpvz.ru','https://www.edpvz.ru']);
Deno.serve(async(req)=>{
 const headers={...baseHeaders,'Vary':'Origin',...(allowedOrigins.has(req.headers.get('origin')||'')?{'Access-Control-Allow-Origin':req.headers.get('origin')!}:{})};
 const reply=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});

 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'METHOD'},405);
 try {
  if(Number(req.headers.get('content-length'))>5500000)return reply({error:'TOO_LARGE'},413);
  const raw=await req.text(); if(raw.length>5500000)return reply({error:'TOO_LARGE'},413);
  const body=JSON.parse(raw);
  const token=Deno.env.get('PVZ_CONTROL_BOT_TOKEN');
  if(!token)return reply({error:'SERVER_NOT_CONFIGURED'},503);
  const uid=await verifyTelegram(body.initData,token);
  const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  if(body.action==='read') {
   const {data,error}=await sb.from('pvz_control_states').select('data,revision,updated_at').eq('user_id',uid).maybeSingle();
   if(error)throw Error('DATABASE');
   return reply({user_id:String(uid),state:data});
  }
  if(body.action==='backups') {
   const {data,error}=await sb.from('pvz_control_backups').select('revision,created_at').eq('user_id',uid).order('revision',{ascending:false});
   if(error)throw Error('DATABASE');return reply({backups:data});
  }
  if(body.action==='backup') {
   const {data,error}=await sb.from('pvz_control_backups').select('data').eq('user_id',uid).eq('revision',body.revision).single();
   if(error)return reply({error:'NOT_FOUND'},404);return reply(data);
  }
  if(body.action!=='write')return reply({error:'ACTION'},400);
  if(!Number.isSafeInteger(body.revision)||body.revision<0)return reply({error:'REVISION'},400);
  const d=body.data;
  if(!d||typeof d!=='object'||!d.settings||!['simple','standard','advanced'].includes(d.settings.mode))return reply({error:'INVALID_DATA'},400);
  for(const key of ['points','people','shifts','incidents','payments','notes','history','reviews','repayments','installments']) {
   if(!Array.isArray(d[key])||d[key].length>100000)return reply({error:'INVALID_DATA'},400);
   if(key!=='history') {const ids=new Set();for(const row of d[key]){if(!row||typeof row.id!=='string'||ids.has(row.id))return reply({error:'INVALID_DATA'},400);ids.add(row.id);}}
  }
  try{validate(d)}catch{return reply({error:'INVALID_DATA'},400)}
  const {data,error}=await sb.rpc('pvz_control_write',{p_user:uid,p_revision:body.revision,p_data:d});
  if(error)throw Error('DATABASE');
  return reply(data,data.conflict?409:200);
 }catch(e){
  const msg= e instanceof Error?e.message:'';
  if(msg.startsWith('AUTH'))return reply({error:msg},401);
  if(e instanceof SyntaxError)return reply({error:'INVALID_JSON'},400);
  console.error('PVZ CONTROL request failed');return reply({error:'SERVER_ERROR'},500);
 }
});
