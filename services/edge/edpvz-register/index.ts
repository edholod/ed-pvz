import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const baseCors={"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Content-Type":"application/json"};
const allowedOrigins=new Set(['https://edholod.github.io','https://edpvz.ru','https://www.edpvz.ru']);
Deno.serve(async(req:Request)=>{
 const cors={...baseCors,'Vary':'Origin',...(allowedOrigins.has(req.headers.get('origin')||'')?{'Access-Control-Allow-Origin':req.headers.get('origin')!}:{})};
 function response(status:number,data:unknown){return new Response(JSON.stringify(data),{status,headers:cors})}

 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return response(405,{message:"Метод не поддерживается"});
 if(!allowedOrigins.has(req.headers.get('origin')||''))return response(403,{message:"Недопустимый источник"});
 try{
  const body=await req.json();
  const username=String(body.username||"").trim().toLowerCase(),password=String(body.password||""),role=String(body.role||"");
  if(!/^[a-z0-9_]{3,32}$/.test(username)||password.length<10||password.length>128||!["owner","supervisor","employee"].includes(role))return response(400,{message:"Логин: 3–32 символа (a-z, 0-9, _). Пароль: 10–128 символов."});
  const ip=req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ip)))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:allow,error:rateError}=await admin.rpc("edpvz_registration_allow",{p_hash:hash});
  if(rateError)return response(503,{message:"Регистрация временно недоступна"});
  if(!allow)return response(429,{message:"Слишком много попыток регистрации. Повторите через час."});
  const {data:existing,error:findError}=await admin.from("edpvz_profiles").select("user_id").eq("username",username).limit(1);
  if(findError)return response(503,{message:"Не удалось проверить логин"});
  if(existing?.length)return response(409,{message:"Логин уже занят"});
  const email=username+"@accounts.edpvz.invalid";
  const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{edpvz_role:role}});
  if(createError)return response(400,{message:createError.message.includes("already")?"Логин уже занят":"Не удалось зарегистрировать аккаунт. Проверьте пароль."});
  const userId=created.user?.id;
  if(!userId)return response(503,{message:"Не удалось создать пользователя"});
  const {error:profileError}=await admin.from("edpvz_profiles").insert({user_id:userId,username,role});
  if(profileError){await admin.auth.admin.deleteUser(userId);const duplicate=profileError.code==="23505";console.error("Profile creation failed",profileError.code,profileError.message);return response(duplicate?409:500,{message:duplicate?"Логин уже занят":"Не удалось создать профиль. Попробуйте ещё раз.",code:profileError.code||"profile_error"})}
  return response(201,{ok:true,username});
 }catch{return response(400,{message:"Ошибка запроса"})}
});