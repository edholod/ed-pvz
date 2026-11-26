export function element(tag, content, attributes = {}) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function button(label, action, attributes) {
  const node = element('button', label, { type: 'button', ...attributes });
  node.addEventListener('click', action);
  return node;
}

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 12 });
const format = n => Number.isFinite(n) ? numberFormat.format(n) : '—';
const numeric = value => value?.trim() ? Number(value.trim().replace(',', '.')) : NaN;
const today = date => [date.getFullYear(), date.getMonth()+1, date.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
const dayMs = 86400000;
const duration = (ms, round = Math.floor) => {
  const seconds = Math.max(0, round(ms/1000));
  const parts = [Math.floor(seconds/3600), Math.floor(seconds/60)%60, seconds%60];
  return parts.map(n=>String(n).padStart(2,'0')).join(':');
};
const ticks = new Set();
let ticker;
function watch(out, update) {
  update(new Date());
  ticks.add({ out, update });
  ticker ??= setInterval(() => {
    if (document.hidden) return;
    const now = new Date();
    for (const tick of ticks) {
      if (tick.out.isConnected) {
        if (tick.out.getClientRects().length) tick.update(now);
      } else ticks.delete(tick);
    }
    if (!ticks.size) {
      clearInterval(ticker);
      ticker = undefined;
    }
  }, 250);
}

function field(parent, label, value, change, type = 'text') {
  const wrap = element('label', label);
  const control = element(type === 'textarea' ? 'textarea' : 'input', null,
    type === 'textarea' ? { rows: 2, maxlength: 4000 } : {type, maxlength: 80, autocomplete: 'off'});
  control.value = value ?? '';
  control.addEventListener('input', () => change(control.value));
  wrap.append(control);
  parent.append(wrap);
  return control;
}

function numberField(parent, label, value, change) {
  const input = field(parent, label, value, change);
  input.inputMode = 'decimal';
  return input;
}

function output(parent, value = '—') {
  const result = element('output',value, { class: 'wm-output' });
  parent.append(result);
  return result;
}

function progress(parent) {
  const bar = element('progress', null, { max: 100, value: 0, 'aria-label': 'Прогресс' });
  parent.append(bar);
  return (fraction) => { bar.value = Math.min(100,Math.max(0,fraction*100)); };
}

function animate(node) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.animate([{ opacity: .65, transform:'translateY(2px)' }, { opacity: 1, transform:'none' }], {duration: 210});
  }
}

function formula(widget, box, data, save) {
  const values = data.values || [];
  widget.fields.forEach((label,index) => numberField(box,label,values[index], value => {
    values[index] = value;
    save({ values });
    update();
  }));
  const result = output(box);
  function update() {
    const numbers = widget.fields.map((_, index) => numeric(values[index]));
    const computed = widget.calculate(...numbers);
    result.textContent = numbers.every(Number.isFinite) && Number.isFinite(computed)
      ? [format(computed),widget.unit].filter(Boolean).join(' ')
      : widget.fields.every((_,index)=>values[index]?.trim()) ? 'Проверьте значения' : '—';
  }
  update();
}

function unit(widget, box, data, save) {
  let value = data.value;
  let reverse = Boolean(data.reverse);
  const select = element('select',null,{'aria-label':'Направление пересчёта'});
  select.append(element('option',widget.from+' → '+widget.to,{value:'forward'}),
    element('option',widget.to+' → '+widget.from,{value:'reverse'}));
  select.value = reverse ? 'reverse' : 'forward';
  box.append(select);
  numberField(box,'Значение',value,next => { value = next; save({value,reverse}); update(); });
  const result = output(box);
  function update() {
    const number = numeric(value);
    const converted = reverse ? (number-widget.offset)/widget.scale : number*widget.scale+widget.offset;
    result.textContent = Number.isFinite(converted) ? format(converted)+' '+(reverse ? widget.from : widget.to) : '—';
  }
  select.addEventListener('change',() => { reverse = select.value === 'reverse'; save({value,reverse}); update(); });
  update();
}

function clock(widget, box) {
  const time = new Intl.DateTimeFormat('ru-RU',{timeZone:widget.zone,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const date = new Intl.DateTimeFormat('ru-RU',{timeZone:widget.zone,day:'numeric',month:'short',weekday:'short'});
  const result = output(box);
  const foot = element('small');
  box.append(foot);
  watch(result, now => {
    const next = time.format(now);
    if (result.textContent === next) return;
    result.textContent = next;
    foot.textContent = date.format(now);
  });
}

function analog(widget, box) {
  const face = element('div',null,{class:'wm-clock-face','aria-hidden':'true'});
  const hands = ['hour','minute','second'].map(part=>element('span',null,{class:'wm-clock-'+part}));
  face.append(...hands);
  box.classList.add('wm-analog');
  box.append(face);
  const result = output(box);
  const time = new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  watch(result,now=>{
    const next=time.format(now);
    if (result.textContent===next) return;
    result.textContent=next;
    const second=now.getSeconds(), minute=now.getMinutes(), hour=now.getHours();
    const angles=[hour*30+minute*.5,minute*6+second*.1,second*6];
    hands.forEach((hand,index)=>hand.style.rotate=angles[index]+'deg');
  });
}

function timer(widget, box, data, save) {
  const stopwatch = widget.kind === 'stopwatch';
  const custom = widget.id === 'custom-timer';
  let length = data.length ?? (widget.seconds || 0)*1000;
  let elapsed = data.elapsed || 0;
  let started = data.started || 0;
  const result = output(box);
  const actions = element('div',null,{class:'wm-actions'});
  const current = now => elapsed + (started ? Math.max(0,now-started) : 0);
  const toggle = button('Старт',() => {
    const now = Date.now();
    if (started) { elapsed = current(now); started = 0; }
    else { if (!stopwatch && elapsed >= length) elapsed = 0; started = now; }
    commit();
  });
  const reset = button('Сброс',() => { started = 0; elapsed = 0; commit(); });
  let minutes;
  if (custom) {
    minutes = numberField(box,'Минуты',data.minutes ?? String(length/60000), value => {
      const n = numeric(value);
      if (Number.isFinite(n) && n > 0 && n <= 1440) {
        length = n*60000;
        elapsed = 0;
        started = 0;
        commit();
      } else update(new Date());
    });
  }
  const setProgress = stopwatch ? null : progress(box);
  actions.append(toggle,reset);
  box.append(actions);
  function commit() {
    save({length,elapsed,started,minutes:minutes?.value});
    update(new Date());
    animate(result);
  }
  function update(now) {
    let ms = current(+now);
    if (!stopwatch && started && ms >= length) {
      started = 0;
      elapsed = length;
      ms = length;
    }
    const value = stopwatch ? duration(ms) : ms >= length ? 'Время вышло' : duration(length-ms,Math.ceil);
    if (result.textContent !== value) {
      result.textContent = value;
      if (value === 'Время вышло') animate(result);
    }
    const title = started ? 'Пауза' : 'Старт';
    if (toggle.textContent !== title) toggle.textContent = title;
    if (minutes) {
      const n = numeric(minutes.value);
      toggle.disabled = !started && !(n>0 && n<=1440);
    }
    setProgress?.(Math.floor(ms/1000)*1000/length);
  }
  watch(result,update);
}

function calendar(widget,box,data,save) {
  const now = new Date();
  let month = new Date(data.year ?? now.getFullYear(),data.month ?? now.getMonth(),1);
  const nav = element('div',null,{class:'wm-actions wm-calendar-nav'});
  const label = element('strong');
  const grid = element('div',null,{class:'wm-calendar'});
  const formatter = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
  const move = offset => {
    const current = new Date();
    month = offset ? new Date(month.getFullYear(),month.getMonth()+offset,1) : new Date(current.getFullYear(),current.getMonth(),1);
    save({year:month.getFullYear(),month:month.getMonth()});
    render();
  };
  nav.append(button('‹',()=>move(-1),{'aria-label':'Предыдущий месяц'}),label,
    button('›',()=>move(1),{'aria-label':'Следующий месяц'}),button('Сегодня',()=>move(0)));
  box.append(nav,grid);
  function render() {
    label.textContent = formatter.format(month);
    grid.replaceChildren(...['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>element('small',day)));
    const preceding = (month.getDay()+6)%7;
    for (let i=0; i<preceding; i++) grid.append(element('span'));
    const size = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    for (let day=1; day<=size; day++) {
      const item = element('span',day);
      if (today(new Date(month.getFullYear(),month.getMonth(),day)) === today(new Date())) item.setAttribute('aria-current','date');
      grid.append(item);
    }
  }
  render();
}

function period(widget,box) {
  const result = output(box);
  const setProgress = progress(box);
  watch(result,now => {
    const year = now.getFullYear(), month = now.getMonth(), day = now.getDate();
    const monday = day-(now.getDay()+6)%7;
    const stages = {
      'week-progress':[new Date(year,month,monday),new Date(year,month,monday+7)],
      'month-progress':[new Date(year,month,1),new Date(year,month+1,1)],
      'year-progress':[new Date(year,0,1),new Date(year+1,0,1)],
    };
    const [start,end] = stages[widget.id];
    const value = (now-start)/(end-start);
    const next = (value*100).toFixed(1).replace('.',',')+' %';
    if (result.textContent !== next) { result.textContent = next; setProgress(value); }
  });
}

function checklist(widget,box,data,save) {
  let items = data.items?.map(item=>({...item})) ?? (widget.items || []).map(label=>({label,done:false}));
  const list = element('ul',null,{class:'wm-checklist'});
  const result = output(box);
  const setProgress = progress(box);
  box.append(list);
  const commit = () => {
    const done = items.filter(item=>item.done).length;
    result.textContent = done+' / '+items.length;
    setProgress(items.length ? done/items.length : 0);
    save({items});
  };
  function render() {
    list.replaceChildren();
    for (const [index,item] of items.entries()) {
      const row = element('li');
      const label = element('label');
      const checkbox = element('input',null,{type:'checkbox'});
      checkbox.checked = item.done;
      checkbox.addEventListener('change',()=>{item.done=checkbox.checked;commit();});
      label.append(checkbox,document.createTextNode(item.label));
      row.append(label);
      if (!widget.items) row.append(button('×',()=>{items.splice(index,1);render();commit();},{'aria-label':'Удалить '+item.label}));
      list.append(row);
    }
  }
  if (widget.items) {
    box.append(button('Сбросить отметки',()=>{items.forEach(item=>{item.done=false;});render();commit();}));
  } else {
    const form = element('form',null,{class:'wm-actions'});
    const input = element('input',null,{placeholder:'Новый пункт','aria-label':'Новый пункт',maxlength:120,required:''});
    form.append(input,element('button','Добавить',{type:'submit'}));
    form.addEventListener('submit',event=>{
      event.preventDefault();
      if (!input.value.trim() || items.length>=30) return;
      items.push({label:input.value.trim(),done:false});
      input.value='';
      render();
      commit();
    });
    box.append(form);
  }
  render();
  const done = items.filter(item=>item.done).length;
  result.textContent = done+' / '+items.length;
  setProgress(items.length ? done/items.length : 0);
}

function map(widget,box,data,save) {
  const initial = '55.75583, 37.61730';
  const form = element('form',null,{class:'wm-map-form'});
  const input = field(form,'Координаты (широта, долгота)',data.coordinates ?? initial,()=>{});
  const status = element('small',null,{role:'status'});
  const link = element('a','Открыть в Яндекс Картах',{target:'_blank',rel:'noopener noreferrer'});
  const frame = element('iframe',null,{title:'Яндекс Карты',loading:'lazy',referrerpolicy:'strict-origin-when-cross-origin'});
  form.append(element('button','Показать',{type:'submit'}));
  box.append(form,status,link,frame);
  function apply(persist) {
    const match = input.value.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*[,; ]\s*([+-]?\d+(?:\.\d+)?)\s*$/);
    const [latitude,longitude] = match ? match.slice(1).map(Number) : [NaN,NaN];
    if (!(Math.abs(latitude)<=90 && Math.abs(longitude)<=180)) {
      status.textContent='Введите координаты, например 55.75, 37.62';
      return;
    }
    status.textContent='';
    const center = longitude+','+latitude;
    const params = new URLSearchParams({ll:center,z:'15',pt:center});
    frame.src='https://yandex.ru/map-widget/v1/?'+params;
    link.href='https://yandex.ru/maps/?'+params;
    if (persist) save({coordinates:input.value});
  }
  form.addEventListener('submit',event=>{event.preventDefault();apply(true);});
  apply(false);
}

function copyButton(box, value) {
  const feedback = element('small',null,{role:'status'});
  const copy = button('Копировать', async () => {
    try { await navigator.clipboard.writeText(value()); feedback.textContent='Скопировано'; }
    catch { feedback.textContent='Копирование недоступно'; }
  });
  box.append(copy,feedback);
}

const renderers = {
  formula,unit,clock,analog,timer,stopwatch:timer,calendar,period,checklist,map,
  deadline(widget,box,data,save) {
    let target = data.target;
    field(box,'Дата и время',target,value=>{target=value;save({target});update(new Date());},'datetime-local');
    const result = output(box);
    function update(now) {
      const left = Date.parse(target)-now;
      const value = !Number.isFinite(left) ? '—' : left<=0 ? 'Срок наступил'
        : (left>=dayMs ? Math.floor(left/dayMs)+' дн. ' : '')+duration(left%dayMs,Math.ceil);
      if (result.textContent!==value) result.textContent=value;
    }
    watch(result,update);
  },
  'iso-week'(widget,box) {
    const result = output(box);
    watch(result,now=>{
      const date = new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
      date.setUTCDate(date.getUTCDate()+4-(date.getUTCDay()||7));
      const week = Math.ceil(((date-Date.UTC(date.getUTCFullYear(),0,1))/dayMs+1)/7);
      const value = week+' / '+date.getUTCFullYear();
      if (result.textContent!==value) result.textContent=value;
    });
  },
  'date-diff'(widget,box,data,save) {
    const values = [...(data.values || [today(new Date()),''])];
    ['Первая дата','Вторая дата'].forEach((label,index)=>field(box,label,values[index],value=>{
      values[index]=value;save({values});update();
    },'date'));
    const result=output(box);
    const update=()=>{const days=Math.abs(Date.parse(values[1])-Date.parse(values[0]))/dayMs;
      result.textContent=Number.isFinite(days) ? format(days)+' дн.' : '—';};
    update();
  },
  note(widget,box,data,save) {
    field(box,'Заметка',data.text,text=>save({text}),'textarea');
  },
  counter(widget,box,data,save) {
    count(widget,box,data,save);
  },
  water(widget,box,data,save) {
    count(widget,box,data,save);
  },
  goal(widget,box,data,save) {
    let {current,target} = data;
    numberField(box,'Текущее значение',current,value=>{current=value;save({current,target});update();});
    numberField(box,'Цель',target,value=>{target=value;save({current,target});update();});
    const result=output(box), setProgress=progress(box);
    function update() {
      const goal=numeric(target), value=numeric(current);
      const valid=goal>0 && Number.isFinite(value);
      result.textContent=valid ? format(value/goal*100)+' %' : '—';
      setProgress(valid ? value/goal : 0);
    }
    update();
  },
  'text-count'(widget,box,data,save) {
    const input=field(box,'Текст',data.text,text=>{save({text});update();},'textarea');
    const result=output(box);
    function update() {
      const text=input.value;
      const words=text.trim() ? text.trim().split(/\s+/u).length : 0;
      result.textContent=words+' слов · '+Array.from(text).length+' симв. · '+(text ? text.split('\n').length : 0)+' строк';
    }
    update();
  },
  'text-case'(widget,box,data,save) {
    const input=field(box,'Текст',data.text,text=>save({text}),'textarea');
    const actions=element('div',null,{class:'wm-actions'});
    for (const [label,transform] of [['ВЕРХНИЙ',s=>s.toLocaleUpperCase('ru')],['нижний',s=>s.toLocaleLowerCase('ru')]]) {
      actions.append(button(label,()=>{input.value=transform(input.value);save({text:input.value});}));
    }
    copyButton(actions,()=>input.value);
    box.append(actions);
  },
  random(widget,box,data,save) {
    let {low='1',high='100',last='—'}=data;
    numberField(box,'От',low,value=>{low=value;save({low,high,last});});
    numberField(box,'До',high,value=>{high=value;save({low,high,last});});
    const result=output(box,last);
    box.append(button('Выбрать',()=>{
      const min=numeric(low),max=numeric(high),range=max-min+1;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || !Number.isSafeInteger(range) || range<=0) {
        result.textContent='Укажите целые числа по порядку';
        return;
      }
      last=format(min+Math.floor(Math.random()*range));
      result.textContent=last;
      save({low,high,last});
      animate(result);
    }));
  },
  color(widget,box,data,save) {
    const input=field(box,'Цвет',data.hex || '#8259bb',hex=>{save({hex});result.textContent=hex.toUpperCase();},'color');
    const result=output(box,input.value.toUpperCase());
    copyButton(box,()=>input.value.toUpperCase());
  },
};

function count(widget,box,data,save) {
  let date=today(new Date());
  let value=(!widget.goal || data.date===date) ? data.value || 0 : 0;
  const result=output(box);
  const setProgress=widget.goal ? progress(box) : null;
  const actions=element('div',null,{class:'wm-actions'});
  function render() {
    const shown=widget.goal ? value+' / '+widget.goal : String(value);
    if (result.textContent!==shown) result.textContent=shown;
    setProgress?.(value/widget.goal);
  }
  function rollover(now) {
    const current=today(now);
    if (widget.goal && current!==date) value=0;
    date=current;
  }
  for (const [label,change] of [['−',n=>Math.max(0,n-1)],['+',n=>n+1],['Сброс',()=>0]]) {
    actions.append(button(label,()=>{
      rollover(new Date());value=change(value);save({value,date});render();animate(result);
    },{'aria-label':label==='+' ? 'Увеличить' : label==='−' ? 'Уменьшить' : 'Сброс'}));
  }
  box.append(actions);
  if (widget.goal) watch(result,now=>{rollover(now);render();});
  else render();
}

export function renderTool(widget, box, data, save) {
  renderers[widget.kind](widget,box,data,save);
}
