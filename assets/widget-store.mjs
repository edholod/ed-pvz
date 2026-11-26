import catalog, { categories } from './widget-catalog.mjs';
import { button, element, renderTool } from './widget-tools.mjs';

const main = document.querySelector('body > main');
if (main) init(main);

function init(main) {
  const widgets = new Map(catalog.map(widget => [widget.id,widget]));
  const baseKey = 'edpvz-widgets-v1:';
  let key = baseKey + 'guest';
  let state;
  const cards = new Map();
  const panel = element('section',null,{id:'widget-board','aria-label':'Виджеты'});
  const board = element('div',null,{class:'wm-board-grid'});
  const message = element('small',null,{class:'wm-storage-status',role:'status',hidden:''});
  const dialog = element('dialog',null,{id:'widget-store','aria-labelledby':'widget-store-title'});
  const open = button('Магазин виджетов',showStore,{class:'wm-open','aria-haspopup':'dialog'});
  const title = element('h2','Магазин виджетов',{id:'widget-store-title'});
  const subtitle = element('p','Бесплатно · '+catalog.length+' виджетов');
  const heading = element('div',null,{class:'wm-store-header'});
  const titleGroup = element('div');
  titleGroup.append(title,subtitle);
  heading.append(titleGroup,button('×',()=>dialog.close(),{'aria-label':'Закрыть магазин',class:'wm-close'}));
  const filters = element('div',null,{class:'wm-filters'});
  const search = element('input',null,{type:'search',placeholder:'Найти виджет',autofocus:'','aria-label':'Найти виджет'});
  const category = element('select',null,{'aria-label':'Категория'});
  category.append(element('option','Все категории',{value:''}));
  for (const [id,[name]] of Object.entries(categories)) category.append(element('option',name,{value:id}));
  const installed = element('input',null,{type:'checkbox'});
  const label = element('label','Добавленные');
  label.prepend(installed);
  filters.append(search,category,label);
  const results = element('div',null,{class:'wm-results'});
  const storeStatus = element('div',null,{class:'wm-sr-only',role:'status'});
  dialog.append(heading,filters,storeStatus,results);
  document.body.append(dialog);
  panel.append(open,message,board);
  main.prepend(panel);

  for (const [control,event] of [[search,'input'],[category,'change'],[installed,'change']]) {
    control.addEventListener(event,()=>{results.scrollTop=0;renderCatalog();});
  }

  function accountId() {
    try { return JSON.parse(localStorage.getItem('edpvz-auth-v1'))?.user?.id; }
    catch { return null; }
  }

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return {order: [...new Set((saved?.order || []).filter(id=>widgets.has(id)))], data:saved?.data || {}};
    } catch { return {order:[],data:{}}; }
  }

  function persist() {
    try {
      localStorage.setItem(key,JSON.stringify(state));
      message.hidden=true;
    } catch {
      message.textContent='В этом браузере изменения сохраняются до закрытия страницы';
      message.hidden=false;
    }
  }

  function switchAccount(id) {
    const next=baseKey+(id || 'guest');
    if (key===next && state) return;
    key=next;
    cards.clear();
    board.replaceChildren();
    sync();
  }

  function sync() {
    state=readState();
    message.hidden=true;
    renderBoard();
    if (dialog.open) renderCatalog();

  }

  window.addEventListener('storage',event=>{
    if (event.key===key || !event.key) sync();
    if (event.key==='edpvz-auth-v1') switchAccount(accountId());
  });
  window.addEventListener('edpvz-auth-changed',event=>switchAccount(event.detail?.user?.id));
  switchAccount(accountId());

  function showStore() {
    renderCatalog();
    dialog.showModal();
    search.focus({preventScroll:true});
  }

  function setWidget(widget, add) {
    if (message.hidden) state=readState();
    if (add) {
      if (!state.order.includes(widget.id)) state.order.push(widget.id);
    } else state.order=state.order.filter(id=>id!==widget.id);
    persist();
    renderBoard();
    if (add) board.lastElementChild?.scrollIntoView({block:'nearest',inline:'nearest',container:'nearest'});
    storeStatus.textContent=widget.title+(add ? ' добавлен на главную' : ' убран с главной');
  }

  function paint(node,widget) {
    const [,glyph,color]=categories[widget.category];
    node.style.setProperty('--wm-tint',color);
    return element('span',glyph,{class:'wm-glyph','aria-hidden':'true'});
  }

  function renderBoard() {
    const active = new Set(state.order);
    for (const [id, {card}] of cards) {
      if (active.has(id)) continue;
      card.remove();
      cards.delete(id);
    }
    let previous = null;
    for (const id of state.order) {
      const value = state.data[id] || {};
      const signature = JSON.stringify(value);
      let entry = cards.get(id);
      if (entry?.signature !== signature) {
        const widget=widgets.get(id);
        const card=element('article',null,{class:'wm-widget'+(widget.wide ? ' wm-wide' : ''),'data-widget':id,'aria-labelledby':'wm-title-'+id});
        const head=element('div',null,{class:'wm-widget-header'});
        const remove=button('×',()=>{
          setWidget(widget,false);
          const next=board.querySelector('.wm-remove') || open;
          next.focus({preventScroll:true});
        },{class:'wm-remove','aria-label':'Убрать виджет '+widget.title});
        head.append(paint(card,widget),element('h3',widget.title,{id:'wm-title-'+id}),remove);
        const box=element('div',null,{class:'wm-tool'});
        entry={card,signature};
        renderTool(widget,box,structuredClone(value),data=>{
          if (message.hidden) state=readState();
          state.data[id]=data;
          entry.signature=JSON.stringify(data);
          persist();
        });
        card.append(head,box);
        cards.get(id)?.card.replaceWith(card);
        cards.set(id,entry);
      }
      if (entry.card !== (previous ? previous.nextElementSibling : board.firstElementChild)) {
        board.insertBefore(entry.card,previous ? previous.nextElementSibling : board.firstElementChild);
      }
      previous=entry.card;
    }
    board.hidden=state.order.length===0;
  }

  function renderCatalog() {
    results.replaceChildren();
    const normalize = value=>value.toLocaleLowerCase('ru').replaceAll('ё','е');
    const query=normalize(search.value.trim()).split(/\s+/);
    const filtered=catalog.filter(widget=>{
      const matchesCategory=!category.value || widget.category===category.value;
      const matchesInstalled=!installed.checked || state.order.includes(widget.id);
      const text=normalize(widget.title+' '+widget.description+' '+categories[widget.category][0]);
      return matchesCategory && matchesInstalled && query.every(word=>text.includes(word));
    });
    if (!filtered.length) results.append(element('p',installed.checked && !query[0] && !category.value
      ? 'Здесь появятся добавленные виджеты' : 'Виджеты не найдены'));
    const fragment=document.createDocumentFragment();
    for (const widget of filtered) {
      const card=element('article',null,{class:'wm-listing','data-listing':widget.id});
      const head=element('div',null,{class:'wm-listing-head'});
      head.append(paint(card,widget),element('h3',widget.title));
      const description=element('p',widget.description);
      const add=button('',()=>{
        const has=state.order.includes(widget.id);
        setWidget(widget,!has);
        if (installed.checked && has) {
          renderCatalog();
          (results.querySelector('button') || installed).focus({preventScroll:true});
        } else paintAction();
      });
      function paintAction() {
        const has=state.order.includes(widget.id);
        add.textContent=has ? '✓ Добавлен' : '+ Добавить';
        add.setAttribute('aria-pressed',String(has));
        add.setAttribute('aria-label',(has ? 'Убрать ' : 'Добавить ')+widget.title);
      }
      paintAction();
      card.append(head,description,add);
      fragment.append(card);
    }
    results.append(fragment);
  }
}
