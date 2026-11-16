const entry = document.getElementById('owner-disputes');
const account = window.EdPVZAccount;
const adminId = '0f75065b-2b26-4a87-bf26-005f5a2284d4';
let version = 0;
let lastUser;

async function refresh() {
  const current = ++version;
  const user = account?.user?.id;
  if (user !== lastUser) entry.hidden = true;
  lastUser = user;
  if (!user) return;
  if (user === adminId) {
    entry.hidden = false;
    return;
  }
  try {
    const organizations = await account.rpc('edpvz_dispute_owner_access', { p_action: 'list' });
    if (current === version && account.user?.id === user) entry.hidden = !organizations.length;
  } catch {
    if (current === version) entry.hidden = true;
  }
}

window.addEventListener('edpvz-auth-changed', refresh);
window.addEventListener('pageshow', refresh);
window.addEventListener('focus', refresh);
void refresh();
