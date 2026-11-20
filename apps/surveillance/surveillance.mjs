const allowedHosts = new Set(['ipeye.ru', 'www.ipeye.ru']);
const playerPaths = new Set(['/ipeye_service/api/iframe.php', '/ipeye_service/api/api.php']);
const deviceCode = url => url.searchParams.get('dev') || url.searchParams.get('devcode');

export function playerURL(value) {
  const source = value.trim();
  const embed = source.match(/<iframe\b[^>]*\ssrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  const address = (embed ?? source).replace(/&amp;/gi, '&');
  const url = new URL(address.startsWith('//') ? 'https:' + address : address);
  if (!allowedHosts.has(url.hostname) || !playerPaths.has(url.pathname) ||
      !['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password ||
      !/^[-_a-z0-9]{8,128}$/i.test(deviceCode(url) || '')) throw new Error('Вставь ссылку или код плеера из раздела «Код для сайта» в IPEYE.');
  url.protocol = 'https:';
  url.hash = '';
  return url.href;
}

const $ = id => document.getElementById(id);
function start() {
  const account = window.EdPVZAccount;
  const picker = $('camera-picker');
  const status = $('camera-status');
  let ownerId = null;
  let version = 0;
  let cameras = [];

  function stopCamera() {
    const text = document.createElement('p');
    text.textContent = 'Выбери добавленную камеру';
    $('player').replaceChildren(text);
    $('camera-actions').hidden = true;
    $('player-note').hidden = true;
    $('external-player').removeAttribute('href');
    $('archive-link').removeAttribute('href');
    picker.value = '';
  }

  function save() {
    if (!ownerId) return;
    try { sessionStorage.setItem('edpvz-ipeye:' + ownerId, JSON.stringify(cameras)); }
    catch { status.textContent = 'Список доступен до перезагрузки этой страницы.'; }
  }

  function options() {
    picker.replaceChildren(new Option(cameras.length ? 'Выбрать камеру' : 'Камеры еще не добавлены', ''),
      ...cameras.map((camera, index) => new Option(camera.name, String(index))));
    picker.disabled = cameras.length === 0;
  }

  function openCamera(value) {
    if (value === '' || !cameras[Number(value)]) { stopCamera(); return; }
    const camera = cameras[Number(value)];
    const iframe = document.createElement('iframe');
    iframe.title = 'IPEYE · ' + camera.name;
    // IPEYE receives the embedding site's origin without the page path or query.
    iframe.referrerPolicy = 'strict-origin';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads allow-presentation');
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.allowFullscreen = true;
    iframe.src = camera.url;
    $('player').replaceChildren(iframe);
    const cabinet = new URL('https://ipeye.ru/ipeye_service/index.php');
    cabinet.searchParams.set('devcode', deviceCode(new URL(camera.url)));
    cabinet.searchParams.set('route', 'page_play');
    $('external-player').href = cabinet.href;
    cabinet.searchParams.set('route', 'page_device_archive');
    $('archive-link').href = cabinet.href;
    $('player-note').hidden = false;
    $('camera-actions').hidden = false;
    picker.value = value;
    status.textContent = '';
  }

  async function checkAccess() {
    const current = ++version;
    const user = account?.user?.id;
    $('account-link').hidden = Boolean(user);
    if (ownerId && user !== ownerId) {
      try { sessionStorage.removeItem('edpvz-ipeye:' + ownerId); } catch {}
      ownerId = null;
      cameras = [];
      status.textContent = '';
      $('camera-form').reset();
      $('add-camera').open = false;
      stopCamera();
      $('viewer').hidden = true;
    }
    if (!user) {
      $('access-status').textContent = 'Для подключения плеера войди в аккаунт собственника.';
      return;
    }
    if (ownerId === user) return;
    try {
      const allowed = await account.rpc('edpvz_surveillance_allowed', {});
      if (current !== version || account.user?.id !== user || !allowed) return;
      ownerId = user;
      try {
        cameras = JSON.parse(sessionStorage.getItem('edpvz-ipeye:' + user) || '[]')
          .map(camera => ({ name: String(camera.name), url: playerURL(camera.url) }));
      } catch { cameras = []; }
      options();
      const requested=new URLSearchParams(location.search).get('camera');
      if(requested!==null && /^\d+$/.test(requested) && cameras[Number(requested)])openCamera(requested);
      $('access-status').textContent = '';
      $('viewer').hidden = false;
    } catch {
      if (version === current) $('access-status').textContent = 'Не удалось проверить доступ. Обнови страницу.';
    }
  }

  picker.addEventListener('change', () => openCamera(picker.value));
  $('stop-camera').addEventListener('click', stopCamera);
  $('remove-camera').addEventListener('click', () => {
    if (picker.value === '') return;
    cameras.splice(Number(picker.value), 1);
    stopCamera();
    options();
    save();
  });
  $('camera-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!ownerId || account.user?.id !== ownerId) return;
    const name = $('camera-name').value.trim();
    if (!name) { status.textContent = 'Укажи название камеры.'; return; }
    let url;
    try { url = playerURL($('camera-code').value); }
    catch {
      status.textContent = 'Скопируй код плеера из раздела «Код для сайта» в IPEYE.';
      return;
    }
    const present = cameras.findIndex(camera => camera.url === url);
    if (present === -1) cameras.push({ name, url });
    else cameras[present] = { name, url };
    options();
    openCamera(String(present === -1 ? cameras.length - 1 : present));
    save();
    event.currentTarget.reset();
    $('add-camera').open = false;
  });
  window.addEventListener('edpvz-auth-changed', checkAccess);
  window.addEventListener('pageshow', checkAccess);
  void checkAccess();
}

if (typeof document !== 'undefined') start();
