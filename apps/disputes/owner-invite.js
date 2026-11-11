const $ = id => document.getElementById(id);
const panel = $('owner-invite');
let organization = null;
let requestNumber = 0;

const messages = {
  owner_not_found: 'Аккаунт собственника с таким логином не найден.',
  access_already_active: 'У этого логина уже есть доступ к выбранному юрлицу.',
  account_required: 'Обнови страницу и выбери логин, у которого нужно отозвать доступ.'
};

function render(result) {
  const accounts = result.accounts || [];
  const list = $('invite-accounts');
  list.hidden = accounts.length === 0;
  list.replaceChildren(...accounts.map(account => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = account.username;
    const date = new Date(account.expires_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
    const labels = { pending: 'Код действует до ' + date, active: 'Доступ активирован', expired: 'Код истёк' };
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.dataset.revokeUsername = account.username;
    revoke.textContent = account.state === 'active' ? 'Отозвать доступ' : 'Отменить код';
    revoke.setAttribute('aria-label', revoke.textContent + ' для ' + account.username);
    item.append(name, ' · ' + labels[account.state] + ' ', revoke);
    return item;
  }));
  $('invite-state').textContent = accounts.length ? 'Аккаунты с кодом или доступом' : 'Коды для этого юрлица ещё не созданы.';
  $('invite-form').hidden = false;
  $('invite-code-box').hidden = !result.code;
  $('invite-code').value = result.code || '';
  $('invite-code-label').textContent = result.code ? 'Код для ' + result.username : 'Код для собственника';
}

async function manage(action, username) {
  if (!organization) return;
  const version = ++requestNumber;
  const form = $('invite-form');
  const button = form.querySelector('button');
  const setBusy = disabled => {
    button.disabled = disabled;
    $('invite-accounts').querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  };
  setBusy(true);
  $('invite-error').textContent = '';
  try {
    const result = await window.EdPVZAccount.rpc('edpvz_dispute_manage_access', {
      p_org: organization, p_action: action, p_username: username || null
    });
    if (version !== requestNumber) return;
    render(result);
    if (action === 'issue') $('invite-username').value = '';
  } catch (error) {
    if (version === requestNumber) {
      $('invite-error').textContent = messages[error.message] || 'Операция не выполнена. Попробуй ещё раз.';
    }
  } finally {
    if (version === requestNumber) setBusy(false);
  }
}

export function showInvite(next) {
  if (!panel || next === organization) return;
  organization = next;
  requestNumber++;
  panel.hidden = !next;
  panel.open = false;
  $('invite-username').value = '';
  $('invite-code').value = '';
  $('invite-code-box').hidden = true;
  $('invite-form').hidden = true;
  $('invite-accounts').hidden = true;
  $('invite-accounts').replaceChildren();
  $('invite-error').textContent = '';
  if (next) {
    $('invite-state').textContent = 'Проверяем доступ…';
    void manage('status');
  }
}

if (panel) {
  $('invite-form').addEventListener('submit', event => {
    event.preventDefault();
    void manage('issue', $('invite-username').value.trim());
  });
  $('invite-accounts').addEventListener('click', event => {
    const username = event.target.closest('[data-revoke-username]')?.dataset.revokeUsername;
    if (username && confirm('Отозвать код или доступ для ' + username + '?')) void manage('revoke', username);
  });
  $('invite-copy').addEventListener('click', async () => {
    const field = $('invite-code');
    try {
      await navigator.clipboard.writeText(field.value);
      $('invite-error').textContent = 'Код скопирован.';
    } catch {
      field.select();
    }
  });
}
