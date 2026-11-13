(function(){'use strict';
const prefix='[Геолокация] ';
function parse(body){const s=String(body||'');if(!s.startsWith(prefix))return null;try{const o=JSON.parse(s.slice(prefix.length));if(!Number.isFinite(o.lat)||!Number.isFinite(o.lon)||Math.abs(o.lat)>90||Math.abs(o.lon)>180)return null;return {lat:o.lat,lon:o.lon,label:typeof o.label==='string'?o.label.slice(0,180):''}}catch{return null}}
function url(p){return 'https://www.openstreetmap.org/?mlat='+encodeURIComponent(p.lat)+'&mlon='+encodeURIComponent(p.lon)+'#map=16/'+encodeURIComponent(p.lat)+'/'+encodeURIComponent(p.lon)}
function render(body){const p=parse(body);if(!p)return null;const a=document.createElement('a');a.className='chat-location-card';a.href=url(p);a.target='_blank';a.rel='noopener noreferrer';const icon=document.createElement('span');icon.className='chat-location-icon';icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';const info=document.createElement('span');const strong=document.createElement('strong');strong.textContent=p.label||'Точка на карте';const sub=document.createElement('small');sub.textContent=p.lat.toFixed(5)+', '+p.lon.toFixed(5)+' · Открыть карту';info.append(strong,sub);a.append(icon,info);return a}
let leafletPromise;
function loadLeaflet(){if(window.L)return Promise.resolve(window.L);if(leafletPromise)return leafletPromise;leafletPromise=new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.append(link);const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.onload=()=>window.L?resolve(window.L):reject(Error('Карта недоступна'));script.onerror=()=>reject(Error('Не удалось загрузить карту'));document.head.append(script)}).catch(e=>{leafletPromise=null;throw e});return leafletPromise}
function attach(context,onSent,onError){
 const overlay=document.createElement('div');overlay.className='chat-location-overlay';overlay.hidden=true;
 const panel=document.createElement('section');panel.className='chat-location-panel';
 const h=document.createElement('h3');h.textContent='Прикрепить точку на карте';
 const desc=document.createElement('p');desc.textContent='Найдите адрес или нажмите на карту, чтобы выбрать любую точку.';
 const search=document.createElement('input');search.type='search';search.className='chat-location-search';search.placeholder='Город, улица, дом или название места';search.setAttribute('aria-label','Поиск адреса');
 const find=document.createElement('button');find.type='button';find.className='chat-location-find';find.textContent='Найти';
 const searchRow=document.createElement('div');searchRow.className='chat-location-search-row';searchRow.append(search,find);
 const results=document.createElement('div');results.className='chat-location-results';results.hidden=true;
 const mapEl=document.createElement('div');mapEl.className='chat-location-map';mapEl.setAttribute('aria-label','Карта для выбора точки');
 const my=document.createElement('button');my.type='button';my.className='chat-location-my';my.textContent='Моё местоположение';
 const coordinates=document.createElement('p');coordinates.className='chat-location-coordinates';coordinates.textContent='Выберите точку на карте';
 const actions=document.createElement('div');actions.className='chat-location-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';
 const send=document.createElement('button');send.type='button';send.textContent='Отправить точку';send.disabled=true;
 actions.append(cancel,send);panel.append(h,desc,searchRow,results,mapEl,my,coordinates,actions);overlay.append(panel);document.body.append(overlay);
 let selected=null,token=0,busy=false,map=null,marker=null;
 function choose(lat,lon,label=''){selected={lat:Number(lat.toFixed(6)),lon:Number(lon.toFixed(6)),label:String(label).slice(0,180)};coordinates.textContent=(selected.label?selected.label+' · ':'')+selected.lat.toFixed(5)+', '+selected.lon.toFixed(5);send.disabled=false;if(map){if(marker)marker.setLatLng([lat,lon]);else marker=window.L.marker([lat,lon]).addTo(map)}}
 function close(){token++;overlay.hidden=true;selected=null;send.disabled=true;results.hidden=true}
 cancel.onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};
 async function open(){if(!context()){onError('Сначала откройте чат');return}overlay.hidden=false;selected=null;send.disabled=true;search.value='';results.hidden=true;coordinates.textContent='Выберите точку на карте';const id=++token;
 try{const L=await loadLeaflet();if(id!==token)return;if(!map){map=L.map(mapEl,{zoomControl:true}).setView([55.75,37.62],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);map.on('click',e=>choose(e.latlng.lat,e.latlng.lng))}setTimeout(()=>{if(id===token)map.invalidateSize()},80)}catch(e){coordinates.textContent='Не удалось загрузить карту. Можно найти адрес через поиск.'}}
 async function lookup(){const q=search.value.trim();if(q.length<3){coordinates.textContent='Введите не менее трёх символов';return}find.disabled=true;results.hidden=false;results.textContent='Ищем адрес…';try{const r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}});if(!r.ok)throw Error('Поиск временно недоступен');const data=await r.json();results.replaceChildren();if(!data.length){results.textContent='Адрес не найден';return}for(const place of data){const b=document.createElement('button');b.type='button';b.textContent=place.display_name;b.onclick=()=>{const lat=Number(place.lat),lon=Number(place.lon);choose(lat,lon,place.display_name);if(map)map.setView([lat,lon],16);results.hidden=true};results.append(b)}}catch(e){results.textContent=e.message||'Ошибка поиска'}finally{find.disabled=false}}
 find.onclick=lookup;search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();lookup()}};
 my.onclick=()=>{if(!navigator.geolocation){coordinates.textContent='Геолокация недоступна';return}my.disabled=true;coordinates.textContent='Определяем местоположение…';const id=token;navigator.geolocation.getCurrentPosition(p=>{my.disabled=false;if(id!==token)return;choose(p.coords.latitude,p.coords.longitude,'Моё местоположение');if(map)map.setView([p.coords.latitude,p.coords.longitude],16)},e=>{my.disabled=false;if(id!==token)return;coordinates.textContent=e.code===1?'Разрешите доступ к геолокации в настройках браузера':'Не удалось определить местоположение'},{enableHighAccuracy:true,timeout:15000,maximumAge:30000})};
 send.onclick=async()=>{if(!selected||busy)return;if(!context()){onError('Чат недоступен');return}busy=true;send.disabled=true;try{await onSent(prefix+JSON.stringify(selected));close()}catch(e){onError(e.message||String(e));send.disabled=false}finally{busy=false}};
 return {open};
}
window.EdPVZChatLocation={attach,render,parse};
})();