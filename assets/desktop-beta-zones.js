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
