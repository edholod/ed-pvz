const ownerId = '0f75065b-2b26-4a87-bf26-005f5a2284d4';
const account = window.EdPVZAccount;
const privateContent = [...document.querySelectorAll('[data-surveillance-private]')];
const gate = document.getElementById('surveillance-access');
const message = document.getElementById('surveillance-access-message');
const login = document.getElementById('surveillance-login');
let version = 0;

function show(allowed, info) {
  for (const node of privateContent) node.hidden = !allowed;
  if (gate) {
    gate.hidden = allowed;
    message.textContent = info;
    login.hidden = Boolean(account?.user);
    if (!allowed) for (const frame of document.querySelectorAll('main[data-surveillance-private] iframe')) frame.remove();
  }
}

async function checkAccess() {
  const check = ++version;
  if (account?.user?.id !== ownerId) {
    show(false, 'Раздел доступен владельцу проекта.');
    return;
  }
  try {
    const allowed = await account.rpc('edpvz_surveillance_allowed', {});
    if (check !== version) return;
    if (allowed === true && account.user?.id === ownerId) show(true, '');
    else show(false, 'Раздел доступен владельцу проекта.');
  } catch {
    if (check === version) show(false, 'Не удалось подтвердить доступ. Обнови страницу.');
  }
}

window.addEventListener('edpvz-auth-changed', checkAccess);
window.addEventListener('pageshow', checkAccess);
void checkAccess();
