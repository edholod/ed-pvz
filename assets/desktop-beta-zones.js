(() => {
  const main = document.querySelector('main');
  const messenger = document.querySelector('#beta-messenger');
  messenger.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l1.4-3.7a8 8 0 1 1 13.6-4.3Z"/><path d="M8 11.5h8"/></svg>');

  const groups = Object.entries({
    points: '.home-points-head, #home-points-list, #beta-all-points, #beta-team-row a[href*="/apps/operations/"], #beta-team-row a[href*="/apps/control/"], #beta-team-row a[href*="/apps/management/"]',
    reviews: '#beta-team-row a[href*="/apps/customer-reviews/"], #beta-team-row a[href*="/apps/rating/"]',
    maps: '#beta-team-row a[href*="/apps/wb-map/"], #beta-team-row a[href*="/apps/ozon-map/"]',
    learning: '#category-1',
    equipment: '#reference-tools',
    shifts: '#category-0, #beta-right-stack .beta-top-tool',
    codes: '#beta-code-heading, #beta-right-stack > a.tile:not(.beta-top-tool)',
    appeals: '#beta-bottom-tools [data-beta-upper-tool]'
  });

  const outlines = groups.map(([name]) => {
    const outline = document.createElement('div');
    outline.className = 'beta-zone-outline';
    outline.dataset.zone = name;
    outline.setAttribute('aria-hidden', 'true');
    outline.hidden = true;
    main.prepend(outline);
    return outline;
  });

  const mode = matchMedia('(min-width:1100px) and (hover:hover) and (pointer:fine)');
  const boxes = new Set();
  let frame;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(update);
  }

  const sizes = new ResizeObserver(schedule);
  sizes.observe(main);
  function update() {
    frame = 0;
    const active = mode.matches && document.body.matches('.desktop-beta:not(.in-app):not(.services-mode)');
    const origin = main.getBoundingClientRect();
    const inset = Math.min(2, parseFloat(getComputedStyle(main).rowGap) / 2 - 0.5);
    const current = new Set();

    groups.forEach(([, selector], index) => {
      const elements = active ? [...main.querySelectorAll(selector)] : [];
      for (const element of elements) current.add(element);
      const bounds = elements.flatMap(element => [...element.getClientRects()])
        .filter(rect => rect.width && rect.height);
      const outline = outlines[index];
      outline.hidden = !bounds.length;
      if (!bounds.length) return;
      const left = Math.min(...bounds.map(rect => rect.left)) - origin.left - inset;
      const top = Math.min(...bounds.map(rect => rect.top)) - origin.top - inset;
      const right = Math.max(...bounds.map(rect => rect.right)) - origin.left + inset;
      const bottom = Math.max(...bounds.map(rect => rect.bottom)) - origin.top + inset;
      Object.assign(outline.style, {
        left: left + 'px', top: top + 'px',
        width: (right - left) + 'px', height: (bottom - top) + 'px'
      });
    });

    for (const node of boxes) if (!current.has(node)) sizes.unobserve(node);
    for (const node of current) if (!boxes.has(node)) sizes.observe(node);
    boxes.clear();
    for (const node of current) boxes.add(node);
  }

  new MutationObserver(schedule).observe(document.body, {attributes: true, attributeFilter: ['class']});
  new MutationObserver(changes => {
    if (changes.some(change => !outlines.includes(change.target))) schedule();
  }).observe(main, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden']});
  mode.addEventListener('change', schedule);
  window.addEventListener('resize', schedule);
  schedule();
})();

(() => {
  const mode = matchMedia('(min-width:1100px) and (hover:hover) and (pointer:fine)');
  const observedDocuments = new WeakSet();
  const styleId = 'edpvz-beta-cursor';
  const surface = 'iframe#viewer, dialog[open] iframe';
  const controls = 'a[href], button:enabled, summary, select:enabled, [role="button"]:not([aria-disabled="true"])';
  const cursor = (path, x, y) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="' + path + '" fill="#7325cf" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + x + ' ' + y;
  };
  const arrow = cursor('M4 2v20l5-5 4 8 4-2-4-8h7Z', 4, 2);
  const hand = cursor('M10 14V5a2 2 0 0 1 4 0v6a2 2 0 0 1 4 0 2 2 0 0 1 4 1 2 2 0 0 1 3 2v5c0 4-3 7-7 7h-3c-3 0-5-2-6-4l-4-6a2 2 0 0 1 3-2l2 2Z', 12, 3);

  function active() {
    return mode.matches && document.body.classList.contains('desktop-beta');
  }

  function styleDocument(doc, enabled, defaultCursor, controlCursor) {
    let style = doc.getElementById(styleId);
    if (!enabled) {
      style?.remove();
      return;
    }
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      doc.head.append(style);
    }
    const css = 'html, body {cursor:' + defaultCursor + '} ' + controls + ' {cursor:' + controlCursor + ' !important}';
    if (style.textContent !== css) style.textContent = css;
  }

  function sync() {
    const enabled = active();
    const defaultCursor = getComputedStyle(document.body).cursor;
    const controlCursor = getComputedStyle(document.querySelector('#beta-messenger')).cursor;
    const chosenArrow = defaultCursor.startsWith('url(') ? defaultCursor : arrow + ', auto';
    const chosenHand = controlCursor.startsWith('url(') ? controlCursor : hand + ', pointer';
    styleDocument(document, enabled, chosenArrow, chosenHand);
    for (const frame of document.querySelectorAll(enabled ? surface : 'iframe')) {
      syncFrame(frame, enabled, chosenArrow, chosenHand);
    }
  }

  function syncFrame(frame, enabled, chosenArrow, chosenHand) {
    const doc = frame.contentDocument;
    if (!doc?.head || doc.URL === 'about:blank') return;
    styleDocument(doc, enabled, chosenArrow, chosenHand);
    observe(doc);
    for (const nested of doc.querySelectorAll('iframe')) {
      syncFrame(nested, enabled, chosenArrow, chosenHand);
    }
  }

  function observe(doc) {
    if (observedDocuments.has(doc)) return;
    observedDocuments.add(doc);
    doc.addEventListener('load', event => {
      if (event.target.tagName === 'IFRAME') sync();
    }, true);
  }

  observe(document);
  new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['class']});
  mode.addEventListener('change', sync);
  sync();
})();

(() => {
  const main = document.querySelector('main');
  const selector = 'a.tile, a.home-point-card, #beta-messenger, .beta-point-placeholder';
  const storageKey = 'edpvz.beta.tile-colors';
  const validColor = color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  let colors = {};
  try {
    colors = JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch {}
  if (typeof colors !== 'object' || Array.isArray(colors)) colors = {};

  const palettes = [
    ['Фиолетовый', '#a77be4'], ['Синий', '#649ce8'], ['Бирюзовый', '#51baa9'],
    ['Зелёный', '#83ba64'], ['Жёлтый', '#f2c656'], ['Оранжевый', '#ee9758'],
    ['Розовый', '#ec85b8'], ['Красный', '#e57985'], ['Серый', '#9caabf']
  ];

  function tileKey(tile) {
    const {origin, pathname, search, hash} = new URL(tile.href);
    return (origin === location.origin ? '' : origin) + pathname + search + hash;
  }

  function syncTile(tile) {
    const color = document.body.classList.contains('desktop-beta') ? colors[tileKey(tile)] : null;
    if (validColor(color)) {
      tile.style.setProperty('--beta-tile-color', color);
      tile.classList.add('beta-tile-custom-color');
    } else {
      tile.style.removeProperty('--beta-tile-color');
      tile.classList.remove('beta-tile-custom-color');
    }
  }

  function save(tile, color) {
    const key = tileKey(tile);
    if (validColor(color)) colors[key] = color;
    else delete colors[key];
    try {
      localStorage.setItem(storageKey, JSON.stringify(colors));
    } catch {}
    for (const match of main.querySelectorAll(selector)) {
      if (tileKey(match) === key) syncTile(match);
    }
  }

  function openPalette(tile) {
    const dialog = document.createElement('dialog');
    dialog.className = 'beta-tile-color-dialog';
    dialog.setAttribute('aria-label', 'Цвет плитки');
    const heading = document.createElement('h2');
    heading.textContent = 'Цвет плитки';
    const name = document.createElement('p');
    name.textContent = (tile.querySelector('b, strong') || tile).textContent.trim();
    const swatches = document.createElement('div');
    swatches.className = 'beta-tile-swatches';
    const selected = colors[tileKey(tile)];

    for (const [label, color] of palettes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(selected === color));
      button.style.backgroundColor = color;
      button.addEventListener('click', () => {
        save(tile, color);
        dialog.close();
      });
      swatches.append(button);
    }

    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Свой цвет';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = validColor(selected) ? selected : palettes[0][1];
    label.append(input);
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.textContent = 'Применить';
    form.append(label, apply);
    form.addEventListener('submit', event => {
      event.preventDefault();
      save(tile, input.value);
      dialog.close();
    });
    const actions = document.createElement('div');
    actions.className = 'beta-tile-color-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Сбросить цвет';
    reset.addEventListener('click', () => {
      save(tile, null);
      dialog.close();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Закрыть';
    cancel.addEventListener('click', () => dialog.close());
    actions.append(reset, cancel);
    dialog.append(heading, name, swatches, form, actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      afterBetaWindowExit(dialog, () => dialog.remove());
      tile.focus({preventScroll: true});
    }, {once: true});
    dialog.showModal();
  }

  const previousMenu = window.EdPVZHoldingMenu;
  window.EdPVZHoldingMenu = target => {
    const items = previousMenu?.(target) || [];
    const tile = target.closest?.(selector);
    if (!tile || !main.contains(tile) || !document.body.classList.contains('desktop-beta')) return items;
    return [...items, {label: 'Изменить цвет плитки', icon: 'settings', run: () => openPalette(tile)}];
  };
  const sync = () => main.querySelectorAll(selector).forEach(syncTile);
  new MutationObserver(sync).observe(main, {subtree: true, childList: true});
  new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['class']});
  sync();
})();

(() => {
  const mode = matchMedia('(min-width:1100px) and (hover:hover) and (pointer:fine)');
  const panel = document.createElement('section');
  panel.id = 'beta-hotkeys';
  panel.setAttribute('aria-labelledby', 'beta-hotkeys-title');
  panel.innerHTML = '<h2 id="beta-hotkeys-title">Горячие клавиши</h2><ul></ul><p role="status" hidden></p>';
  const list = panel.querySelector('ul');
  const status = panel.querySelector('[role="status"]');
  document.querySelector('main').append(panel);
  let capturing = false;

  function report(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }

  async function screenshot() {
    if (capturing) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      report('В этом браузере захват экрана недоступен.');
      return;
    }
    capturing = true;
    report();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false, preferCurrentTab: true});
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!image) throw new Error('Screenshot unavailable');
      const file = URL.createObjectURL(image);
      const download = document.createElement('a');
      download.href = file;
      download.download = 'edpvz-screenshot.png';
      download.click();
      setTimeout(() => URL.revokeObjectURL(file), 30000);
    } catch (error) {
      if (error.name !== 'NotAllowedError') report('Не удалось сохранить скриншот.');
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      capturing = false;
    }
  }

  const press = selector => document.querySelector(selector)?.click();
  const calendar = () => {
    const tile = document.querySelector('#category-0 a[href*="/apps/control/"]');
    if (tile) window.openSection(tile.href, 'Календарь смен');
  };
  const openTab = url => window.open(url, '_blank', 'noopener,noreferrer');
  const actions = [
    ['s', 'ы', 'Сервисы', () => window.__edpvzShowServices()],
    ['z', 'я', 'Все ПВЗ', () => press('#beta-all-points')],
    ['q', 'й', 'Эдсенджер', () => window.openSection(document.querySelector('#beta-messenger').href, 'Эдсенджер')],
    ['k', 'л', 'Календарь смен', calendar],
    ['a', 'ф', 'Скриншот', screenshot],
    ['w', 'ц', 'Открыть WB Point', () => openTab('https://pvz-lk.wb.ru/')],
    ['o', 'щ', 'Открыть Турбо ПВЗ', () => openTab('https://turbo-pvz.ozon.ru/')]
  ];

  const byKey = new Map();
  for (const [latin, cyrillic, label, run] of actions) {
    byKey.set(latin, run);
    byKey.set(cyrillic, run);
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-keyshortcuts', latin.toUpperCase());
    const keycap = document.createElement('kbd');
    keycap.textContent = latin.toUpperCase();
    button.append(keycap, document.createTextNode(label));
    button.addEventListener('click', run);
    row.append(button);
    list.append(row);
  }

  const editing = 'input, textarea, select, [role="textbox"]';
  function onKey(event) {
    if (!mode.matches || !document.body.classList.contains('desktop-beta')) return;
    if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.composedPath().some(node => node.isContentEditable || node.matches?.(editing))) return;
    const run = byKey.get(event.key.toLowerCase());
    if (!run) return;
    event.preventDefault();
    run();
  }

  const watched = new WeakSet();
  function watch(doc) {
    if (!doc || watched.has(doc)) return;
    watched.add(doc);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('load', event => {
      if (event.target.tagName === 'IFRAME') watch(event.target.contentDocument);
    }, true);
    for (const frame of doc.querySelectorAll('iframe')) watch(frame.contentDocument);
  }
  watch(document);
})();
