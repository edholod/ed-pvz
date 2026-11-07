/* Ed PVZ: accessible, monochrome inline SVG icons replacing decorative emoji. */
(()=>{'use strict';
const paths={
spark:'M12 2l2.4 6.8L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.2z',
box:'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2',
users:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 20v-2a4 4 0 0 0-3-3.9 M16 2.2a4 4 0 0 1 0 7.6',
award:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
gift:'M3 10h18v11H3z M2 7h20v4H2z M12 7v14 M12 7c-6 0-7-5-4-6 3-1 4 4 4 6z M12 7c6 0 7-5 4-6-3-1-4 4-4 6z',
cloud:'M6 19h12a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-2 5 5 0 0 0 0 10z',
sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1',
snow:'M12 2v20 M3.3 7l17.4 10 M3.3 17L20.7 7 M9 5l3 3 3-3 M9 19l3-3 3 3',
rain:'M6 17l-1 4 M12 17l-1 4 M18 17l-1 4 M5 14h14a4 4 0 0 0-2-8 6 6 0 0 0-11 1 4 4 0 0 0-1 7',
zap:'M13 2L4 13h7l-1 9 10-12h-7z',
home:'M3 10l9-7 9 7v11H3z M9 21v-8h6v8',
search:'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M17 17l5 5',
megaphone:'M3 10v4h4l11 5V5L7 10z M7 14l2 7h3l-2-6',
chart:'M3 21V3 M3 21h18 M7 17v-6 M12 17V7 M17 17V4',
settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
lock:'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
star:'M12 2l3.1 6.5 7.1 1-5.1 5 1.2 7.1-6.3-3.3-6.3 3.3 1.2-7.1-5.1-5 7.1-1z',
money:'M3 6h18v12H3z M12 9v6 M9 11h6 M6 9h.01 M18 15h.01',
game:'M7 9h10a5 5 0 0 1 4.8 4l1 5a3 3 0 0 1-5 2l-2-2H8l-2 2a3 3 0 0 1-5-2l1-5A5 5 0 0 1 7 9z M7 13v5 M4.5 15.5h5 M16 14h.01 M19 16h.01',
warning:'M12 3L2 21h20z M12 9v5 M12 17h.01',
calendar:'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18 M8 14h3 M14 14h3',
check:'M4 12l5 5L20 6',
download:'M12 3v13 M7 11l5 5 5-5 M4 20h16',
book:'M4 4h8a4 4 0 0 1 4 4v13a4 4 0 0 0-4-4H4z M16 8a4 4 0 0 1 4-4v13h-4',
news:'M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5',
qr:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h3 M21 14v4 M14 21h7',
clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
heart:'M12 21L3 12a5 5 0 0 1 9-5 5 5 0 0 1 9 5z',
generic:'M12 3l2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z'};
const mapping={'⚠':'warning','🎉':'spark','🎲':'game','👤':'user','📦':'box','❄':'snow','🔴':'generic','🟢':'generic','🟠':'generic','🏆':'award','🏪':'home','🎁':'gift','☁':'cloud','☀':'sun','🌨':'snow','🌧':'rain','⛅':'cloud','⛈':'zap','🌦':'rain','⚡':'zap','👥':'users','🏠':'home','🔎':'search','📣':'megaphone','🏅':'award','🥇':'award','📊':'chart','✨':'spark','⚙':'settings','⌛':'clock','🔒':'lock','⭐':'star','💰':'money','💵':'money','💎':'spark','🃏':'game','🎡':'game','🎮':'game','🌟':'star','💖':'heart','❤️':'heart','🎯':'check','📅':'calendar','🗓':'calendar','📚':'book','📰':'news','📱':'generic','💻':'generic','📥':'download','💾':'download','🎓':'award','🔥':'spark','❗':'warning','❌':'warning','✅':'check','🚀':'spark','🔔':'megaphone','🎂':'gift','💡':'spark'};
const rx=/[⚠🎉🎲👤📦❄🔴🟢🟠🏆🏪🎁☁☀🌨🌧⛅⛈🌦⚡👥🏠🔎📣🏅🥇📊✨⚙⌛🔒⭐💰💵💎🃏🎡🎮🌟💖❤🎯📅🗓📚📰📱💻📥💾🎓🔥❗❌✅🚀🔔🎂💡]️?/gu;
function icon(name){const el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.setAttribute('viewBox','0 0 24 24');el.setAttribute('width','1em');el.setAttribute('height','1em');el.setAttribute('fill','none');el.setAttribute('stroke','currentColor');el.setAttribute('stroke-width','1.8');el.setAttribute('stroke-linecap','round');el.setAttribute('stroke-linejoin','round');el.setAttribute('aria-hidden','true');el.classList.add('edpvz-svg-icon');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.generic);el.append(path);return el}
function transform(root){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){if(!node.parentElement||node.parentElement.closest('script,style,textarea,pre,code,svg,[contenteditable="true"]'))return NodeFilter.FILTER_REJECT;rx.lastIndex=0;return rx.test(node.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}});const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){const text=node.nodeValue;rx.lastIndex=0;const matches=[...text.matchAll(rx)];if(!matches.length)continue;const fragment=document.createDocumentFragment();let cursor=0;for(const m of matches){if(m.index>cursor)fragment.append(document.createTextNode(text.slice(cursor,m.index)));const symbol=m[0].replace(/️/g,'');const span=document.createElement('span');span.className='edpvz-icon-wrap';span.setAttribute('role','img');span.setAttribute('aria-label',symbol);span.append(icon(mapping[symbol]||'generic'));fragment.append(span);cursor=m.index+m[0].length}if(cursor<text.length)fragment.append(document.createTextNode(text.slice(cursor)));node.replaceWith(fragment)}}
function init(){const style=document.createElement('style');style.textContent='.edpvz-icon-wrap{display:inline-flex;align-items:center;justify-content:center;vertical-align:-.12em;line-height:1;color:inherit}.edpvz-svg-icon{display:inline-block;flex:none}';document.head.append(style);transform(document.body);let scheduled=false;const observer=new MutationObserver(records=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;for(const record of records){if(record.type==='characterData'&&record.target.parentElement)transform(record.target.parentElement);for(const node of record.addedNodes)if(node.nodeType===1)transform(node);else if(node.nodeType===3&&node.parentElement)transform(node.parentElement)}})});observer.observe(document.body,{childList:true,characterData:true,subtree:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();