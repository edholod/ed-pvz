(()=>{'use strict';
const layout=document.getElementById('layout'),back=document.getElementById('backChats');
if(!layout)return;
const mobile=()=>matchMedia('(max-width:650px)').matches;
let raf=0;
function resize(){
 if(!mobile()){document.documentElement.style.removeProperty('--eds-height');document.documentElement.style.removeProperty('--eds-top');return}
 const vv=window.visualViewport;
 const height=vv?Math.min(window.innerHeight,vv.height):window.innerHeight;
 document.documentElement.style.setProperty('--eds-top',Math.max(0,Math.round(vv?.offsetTop||0))+'px');
 document.documentElement.style.setProperty('--eds-height',Math.max(260,Math.round(height))+'px');
}
function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(resize)}
window.addEventListener('resize',schedule,{passive:true});
window.visualViewport?.addEventListener('resize',schedule,{passive:true});
window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
schedule();
window.addEventListener('pageshow',()=>{if(mobile()){window.scrollTo(0,0);schedule()}},{passive:true});
let start=null;
layout.addEventListener('touchstart',e=>{
 if(!mobile()||!layout.classList.contains('chat-open')||e.touches.length!==1||e.target.closest('textarea,input,button,a,[role="button"],.composer')){start=null;return}
 const t=e.touches[0];start=t.clientX<35?{x:t.clientX,y:t.clientY,time:Date.now()}:null;
},{passive:true});
layout.addEventListener('touchend',e=>{
 if(!start||!mobile()||!layout.classList.contains('chat-open'))return;
 const t=e.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;
 if(dx>85&&Math.abs(dy)<dx*.55&&Date.now()-start.time<700)back?.click();
 start=null;
},{passive:true});
layout.addEventListener('touchcancel',()=>start=null,{passive:true});
document.addEventListener('focusin',e=>{if(e.target.matches('textarea,input'))schedule()});
document.addEventListener('focusout',()=>schedule());
})();