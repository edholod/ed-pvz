/* Эд ПВЗ — site-wide Supabase Realtime. Never exposes row payloads to the UI. */
(()=>{'use strict';
const TABLES=['edpvz_points','edpvz_memberships','edpvz_staff_cards','edpvz_manager_shifts','edpvz_shift_requests','edpvz_shift_control_reports','edpvz_shift_control_settings','edpvz_tasks','edpvz_finance_entries','edpvz_notifications','edpvz_customer_reviews','edpvz_customer_review_links','edpvz_jobs','edpvz_replacements','edpvz_replacement_applications','edpvz_market_listings','edpvz_user_data','edpvz_profiles','edpvz_push_subscriptions'];
const GROUPS={account:['points','memberships','staff_cards','notifications','profiles'],users:['memberships','staff_cards','points','notifications','profiles'],messages:[],management:['points','memberships','staff_cards','tasks','manager_shifts','shift_requests'],marketplace:['market_listings'],jobs:['jobs','replacements','replacement_applications'],calendar:['manager_shifts','shift_requests','staff_cards','memberships','points'],tasks:['tasks'],finance:['finance_entries'],reviews:['customer_reviews','customer_review_links'],shift:['shift_control_reports','shift_control_settings','shift_requests']};
let client=null,channel=null,identity='',retry=null,pending=null;
const account=()=>window.EdPVZAccount;
const tableMatches=(url,table)=>{const p=String(url||'').toLowerCase();return Object.entries(GROUPS).some(([k,parts])=>p.includes(k)&&parts.some(x=>table.endsWith(x)))};
function notify(table){window.dispatchEvent(new CustomEvent('edpvz-realtime-change',{detail:{table}}));
const frame=document.getElementById('viewer');if(!frame||!frame.src||!tableMatches(frame.src,table))return;
clearTimeout(pending);pending=setTimeout(()=>{try{const doc=frame.contentDocument;if(!doc)return;const active=doc.activeElement;const editing=active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active!==doc.body;if(editing){let notice=document.getElementById('edpvz-live-notice');if(!notice){notice=document.createElement('button');notice.id='edpvz-live-notice';notice.type='button';notice.textContent='Данные обновились · Обновить раздел';notice.style.cssText='position:fixed;bottom:78px;left:50%;transform:translateX(-50%);z-index:99999;border:0;border-radius:14px;background:#873369;color:white;padding:12px 16px;box-shadow:0 5px 22px #0002;font:600 13px system-ui;max-width:92vw';notice.onclick=()=>{notice.remove();frame.contentWindow.location.reload()};document.body.append(notice)}return}
frame.contentWindow.location.reload()}catch(e){}},650)};
async function stop(){clearTimeout(retry);if(client&&channel)try{await client.removeChannel(channel)}catch(e){}channel=null;client=null;identity=''}
async function start(){const a=account();if(!a||!window.supabase?.createClient)return;let session;try{session=await a.ensure()}catch(e){return}const uid=session?.user?.id;if(!uid){if(identity)await stop();return}if(identity===uid&&channel)return;await stop();identity=uid;
client=window.supabase.createClient('https://duerixyhzapotoeclggz.supabase.co','sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},accessToken:async()=>{try{return (await account().ensure())?.access_token||null}catch(e){return null}}});
channel=client.channel('edpvz-site-sync-'+uid);
for(const table of TABLES)channel.on('postgres_changes',{event:'*',schema:'public',table},()=>notify(table));
channel.subscribe(status=>{window.dispatchEvent(new CustomEvent('edpvz-realtime-status',{detail:{status}}));if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(retry);retry=setTimeout(()=>{stop().then(start)},7000)}});
}
window.addEventListener('edpvz-auth-changed',()=>{stop().then(start)});
window.addEventListener('online',start);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)start()});
window.EdPVZRealtime={start,stop};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();