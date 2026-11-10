import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
const baseCors={"Access-Control-Allow-Headers":"authorization,apikey,content-type","Content-Type":"application/json"};
const allowedOrigins=new Set(['https://edholod.github.io','https://edpvz.ru','https://www.edpvz.ru']);
Deno.serve(async(req)=>{
 const cors={...baseCors,'Vary':'Origin',...(allowedOrigins.has(req.headers.get('origin')||'')?{'Access-Control-Allow-Origin':req.headers.get('origin')!}:{})};

 if(req.method==="OPTIONS")return new Response("",{headers:cors});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),privateKey=Deno.env.get("EDPVZ_VAPID_PRIVATE_KEY");
 if(!url||!secret||!privateKey)return new Response(JSON.stringify({error:"Push server is not configured"}),{status:503,headers:cors});
 const auth=req.headers.get("Authorization")||"";
 if(auth!=="Bearer "+secret)return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:cors});
 const db=createClient(url,secret,{auth:{persistSession:false}});
 webpush.setVapidDetails("mailto:push@edpvz.invalid","BKncf5_6c6roaALwivH1Mo_eT3DVWCcXOvDMpIbXCHcws1Qu8_JUhPbUQszg_foqyynq73lZ7pgGo5Yhlwy2Krc",privateKey);
 const {data:subs,error:se}=await db.from("edpvz_push_subscriptions").select("id,user_id,endpoint,p256dh,auth_key,created_at").limit(200);
 if(se)return new Response(JSON.stringify({error:se.message}),{status:500,headers:cors});
 let sent=0,failed=0;
 for(const sub of subs||[]){
  const {data:events,error:ne}=await db.from("edpvz_notifications").select("id,title,body,created_at").eq("user_id",sub.user_id).gte("created_at",sub.created_at).order("created_at",{ascending:true}).limit(30);
  if(ne){failed++;continue}
  const {data:delivered}=await db.from("edpvz_push_deliveries").select("notification_id").eq("subscription_id",sub.id).in("notification_id",(events||[]).map(x=>x.id).length?(events||[]).map(x=>x.id):[-1]);
  const done=new Set((delivered||[]).map(x=>String(x.notification_id)));
  for(const event of events||[]){
   if(done.has(String(event.id)))continue;
   try{
    await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_key}},JSON.stringify({title:event.title,body:event.body,url:"/ed-pvz/apps/account/#notifications"}),{TTL:86400});
    await db.from("edpvz_push_deliveries").upsert({subscription_id:sub.id,notification_id:event.id},{onConflict:"subscription_id,notification_id"});sent++;
   }catch(e){
    if(e.statusCode===404||e.statusCode===410){await db.from("edpvz_push_subscriptions").delete().eq("id",sub.id);break}
    failed++;break;
   }
  }
 }
 return new Response(JSON.stringify({sent,failed}),{headers:cors});
});