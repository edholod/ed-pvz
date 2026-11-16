const cabinetOrigin = 'https://my.ivideon.com';
const cameraPath = /^\/(?:cameras?|devices?)\/[a-z0-9_:%/.-]+\/?$/i;

export function cameraURL(value) {
  const url = new URL(value.trim());
  if (url.origin !== cabinetOrigin || url.username || url.password) throw Error('Нужна ссылка из личного кабинета Ivideon.');
  const hash = url.hash.slice(1).split('?')[0];
  const cameraInHash = url.pathname === '/' && cameraPath.test(hash);
  if (!cameraPath.test(url.pathname) && !cameraInHash) throw Error('Скопируй адрес после открытия конкретной камеры в Ivideon.');
  url.search = '';
  url.hash = cameraInHash ? hash : '';
  return url.href;
}

const $ = id => document.getElementById(id);

function start() {
  const account = window.EdPVZAccount;
  const list = $('camera-list');
  const form = $('camera-form');
  const cameraStatus = $('camera-status');
  let owner = null;
  let version = 0;
  let cameras = [];

  const storageKey = id => 'edpvz-ivideon:' + id;
  function render() {
    list.replaceChildren(...cameras.map(({name, url}, index) => {
      const row = document.createElement('li');
      const open = document.createElement('a');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = name + ' ↗';
      const remove = document.createElement('button');
      remove.className = 'text-button';
      remove.type = 'button';
      remove.textContent = 'Убрать';
      remove.setAttribute('aria-label', 'Убрать ссылку на камеру ' + name);
      remove.onclick = () => {
        cameras.splice(index, 1);
        save();
      };
      row.append(open, remove);
      return row;
    }));
  }

  function save() {
    cameraStatus.textContent = '';
    try { sessionStorage.setItem(storageKey(owner), JSON.stringify(cameras)); }
    catch { cameraStatus.textContent = 'Ссылки доступны до обновления этой страницы.'; }
    render();
  }

  async function checkAccess() {
    const request = ++version;
    const id = account?.user?.id;
    $('account-link').hidden = Boolean(id);
    if (owner && owner !== id) {
      try { sessionStorage.removeItem(storageKey(owner)); } catch {}
      owner = null;
      cameras = [];
      render();
      form.reset();
      $('add-camera').open = false;
      $('workspace').hidden = true;
      cameraStatus.textContent = '';
    }
    if (!id) {
      $('status').textContent = 'Войди как собственник, чтобы сохранять ссылки.';
      return;
    }
    if (id === owner) return;
    $('status').textContent = 'Проверяем доступ…';
    try {
      const profiles = await account.readTable('edpvz_profiles?select=role&user_id=eq.' + encodeURIComponent(id));
      if (request !== version || account.user?.id !== id) return;
      if (!profiles.some(profile => profile.role === 'owner')) {
        $('status').textContent = 'Ссылки на камеры может добавлять собственник ПВЗ.';
        return;
      }
      owner = id;
      try {
        cameras = JSON.parse(sessionStorage.getItem(storageKey(id)) || '[]').map(camera => ({
          name: String(camera.name), url: cameraURL(camera.url)
        }));
      } catch { cameras = []; }
      render();
      $('status').textContent = '';
      $('workspace').hidden = false;
    } catch {
      if (request === version) $('status').textContent = 'Не удалось проверить доступ. Обнови страницу.';
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!owner || account.user?.id !== owner) return;
    const name = $('camera-name').value.trim();
    if (!name) { cameraStatus.textContent = 'Укажи название камеры.'; return; }
    try {
      const url = cameraURL($('camera-link').value);
      const previous = cameras.find(camera => camera.url === url);
      if (previous) previous.name = name;
      else cameras.push({ name, url });
      save();
      form.reset();
      $('add-camera').open = false;
    } catch (error) {
      cameraStatus.textContent = error instanceof TypeError ? 'Вставь ссылку из кабинета Ivideon.' : error.message;
    }
  });
  window.addEventListener('edpvz-auth-changed', checkAccess);
  window.addEventListener('pageshow', checkAccess);
  void checkAccess();
}

if (typeof document !== 'undefined') start();
