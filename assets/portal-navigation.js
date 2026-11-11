/* The outer portal owns navigation. App links never create another portal frame. */
(()=>{
 'use strict';
 const root=new URL('./',document.currentScript.src.replace(/assets\/portal-navigation\.js.*$/,''));
 const apps=new URL('apps/',root);
 function isApp(value){try{const u=new URL(value,root);return u.origin===apps.origin&&u.pathname.startsWith(apps.pathname)&&!u.username&&!u.password}catch{return false}}
 function section(value){try{const u=new URL(value,root);return u.hash.startsWith('#section=')?decodeURIComponent(u.hash.slice(9)):null}catch{return null}}
 function titleFor(doc){return (doc.title||'Раздел').replace(/\s*[—·|]\s*Эд ПВЗ.*$/,'').slice(0,100)}
 function loaded(){
  const frame=document.getElementById('viewer');
  try{
   const doc=frame.contentDocument,u=new URL(frame.contentWindow.location.href);
   if(!doc)return;
   if(u.origin===root.origin&&(u.pathname===root.pathname||u.pathname===new URL('index.html',root).pathname)){
    const target=section(u.href)||doc.querySelector('#viewer')?.src;
    if(isApp(target))window.openSection(target,'Раздел',false);else window.home();
    return;
   }
   if(!isApp(u.href))return;
   document.getElementById('viewTitle').textContent=titleFor(doc);
   document.getElementById('external').href=u.href;
   document.title=titleFor(doc)+' — Эд ПВЗ';
   // A standalone app may contain its own home breadcrumb.
   doc.querySelectorAll('.appbar,nav[aria-label="Навигация"]').forEach(n=>{n.hidden=true;n.style.display='none'});
   doc.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');
    if(!link||event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.download||link.target==='_blank')return;
    const target=new URL(link.href,doc.baseURI);
    if(target.origin!==root.origin)return;
    if(target.pathname===root.pathname||target.pathname===new URL('index.html',root).pathname){
     event.preventDefault();const nested=section(target.href);
     if(isApp(nested))window.openSection(nested,'Раздел');else window.home();
    }else if(isApp(target.href)&&(target.pathname!==u.pathname||target.search!==u.search)){event.preventDefault();window.openSection(target.href,link.querySelector('strong,b')?.textContent||link.textContent.trim()||'Раздел')}
   });
  }catch{/* Cross-origin tools keep their own navigation. */}
 }
 window.EdPVZPortalNavigation={isApp,loaded};
})();
