const account = window.EdPVZAccount;
const privateContent = [...document.querySelectorAll('[data-surveillance-private]')];
const ivideonContent = privateContent.filter(node => node.dataset.surveillancePrivate === 'ivideon');
const legacyContent = privateContent.filter(node => node.dataset.surveillancePrivate !== 'ivideon');
const gate = document.getElementById('surveillance-access');
const message = document.getElementById('surveillance-access-message');
const login = document.getElementById('surveillance-login');
const pageScope = document.querySelector('main[data-surveillance-private]')?.dataset.surveillancePrivate;
let version = 0;
let checkedUser;

function show(ivideon, legacy, info) {
  for (const node of ivideonContent) node.hidden = !ivideon;
  for (const node of legacyContent) node.hidden = !legacy;
  if (gate) {
    const allowed = pageScope === 'ivideon' ? ivideon : legacy;
    gate.hidden = allowed;
    message.textContent = info;
    login.hidden = Boolean(account?.user);
    if (!allowed) for (const frame of document.querySelectorAll('main[data-surveillance-private] iframe')) frame.remove();
  }
}

async function checkAccess() {
  const check = ++version;
  const user = account?.user?.id;
  if (user !== checkedUser) show(false, false, 'Проверяем доступ…');
  checkedUser = user;
  const denied = pageScope === 'ivideon'
    ? 'Войди в аккаунт собственника «Эд ПВЗ».'
    : 'Раздел доступен владельцу проекта.';
  if (!user) {
    show(false, false, denied);
    return;
  }
  const request = (nodes, rpc) => nodes.length ? account.rpc(rpc, {}) : Promise.resolve(false);
  const [ivideon, legacy] = await Promise.allSettled([
    request(ivideonContent, 'edpvz_ivideon_allowed'),
    request(legacyContent, 'edpvz_surveillance_allowed'),
  ]);
  if (check !== version || account.user?.id !== user) return;
  const pageAccess = pageScope === 'ivideon' ? ivideon : legacy;
  show(ivideon.status === 'fulfilled' && ivideon.value === true,
    legacy.status === 'fulfilled' && legacy.value === true,
    pageAccess.status === 'rejected' ? 'Не удалось подтвердить доступ. Обнови страницу.' : denied);
}

window.addEventListener('edpvz-auth-changed', checkAccess);
window.addEventListener('pageshow', checkAccess);
void checkAccess();
