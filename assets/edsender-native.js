(()=>{'use strict';
const layout=document.getElementById('layout'),back=document.getElementById('backChats');
if(!layout)return;
const mobile=()=>matchMedia('(max-width:650px)').matches;
let raf=0;
function resize(){
 const main=document.querySelector('main');
 if(!main)return;
 if(!mobile()){main.style.removeProperty('height');return}
 const vv=window.visualViewport;
 const keyboardOpen=!!vv && vv.height < window.innerHeight-140;
 // Resize only when the software keyboard is genuinely open.
 // VisualViewport scroll events during normal gestures must not move the shell.
 main.style.height=keyboardOpen?Math.round(vv.height)+'px':'';
}
function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(resize)}
window.addEventListener('resize',schedule,{passive:true});
window.visualViewport?.addEventListener('resize',schedule,{passive:true});
schedule();
window.addEventListener('pageshow',schedule,{passive:true});
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