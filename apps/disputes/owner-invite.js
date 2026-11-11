const $ = id => document.getElementById(id);
const panel = $('owner-invite');
let organization = null;
let requestNumber = 0;
let passwordSet = false;

const messages = {
  invalid_password_length: 'Укажи пароль от 12 символов и не длиннее 72 байт.',
  password_in_use: 'Этот пароль уже используется для другого юрлица. Задай другой.'
};

function renderPasswordState(result) {
  passwordSet = result.password_set === true;
  $('invite-state').textContent = passwordSet
    ? 'Пароль установлен. Передай его собственнику.'
    : 'Пароль для этого юрлица не установлен.';
  $('invite-password-remove').hidden = !passwordSet;
  $('invite-form').hidden = false;
}

function renderAccounts(accounts) {
  const list = $('invite-accounts');
  list.hidden = !accounts.length;
  list.replaceChildren(...accounts.map(account => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = account.username;
    const labels = { pending: 'Ожидает активации кода', active: 'Доступ активирован', expired: 'Код истёк' };
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.dataset.revokeUsername = account.username;
    revoke.dataset.active = String(account.state === 'active');
    revoke.textContent = account.state === 'active' ? 'Отозвать доступ' : 'Отменить код';
    revoke.setAttribute('aria-label', revoke.textContent + ' для ' + account.username);
    item.append(name, ' · ' + labels[account.state] + ' ', revoke);
    return item;
  }));
}

async function manage(action, value) {
  if (!organization) return;
  const version = ++requestNumber;
  const accountAction = action === 'status' || action === 'revoke';
  const setBusy = disabled => {
    panel.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  };
  setBusy(true);
  $('invite-error').textContent = '';
  try {
    const result = await window.EdPVZAccount.rpc(
      accountAction ? 'edpvz_dispute_manage_access' : 'edpvz_dispute_manage_password',
      { p_org: organization, p_action: action, ...(accountAction ? { p_username: value || null } : { p_password: value || null }) }
    );
    if (version !== requestNumber) return;
    renderPasswordState(result);
    if (accountAction) renderAccounts(result.accounts || []);
    if (action === 'save') $('invite-password').value = '';
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
  passwordSet = false;
  panel.hidden = !next;
  panel.open = false;
  $('invite-password').value = '';
  $('invite-form').hidden = true;
  renderAccounts([]);
  $('invite-error').textContent = '';
  if (next) {
    $('invite-state').textContent = 'Проверяем доступ…';
    void manage('status');
  }
}

if (panel) {
  $('invite-form').addEventListener('submit', event => {
    event.preventDefault();
    const password = $('invite-password').value;
    if (password.trim().length < 12 || new TextEncoder().encode(password).length > 72) {
      $('invite-error').textContent = messages.invalid_password_length;
      return;
    }
    void manage('save', password);
  });
  $('invite-password-remove').addEventListener('click', () => {
    if (confirm('Удалить пароль для новых подключений? Подключённые аккаунты сохранят доступ.')) void manage('remove');
  });
  $('invite-accounts').addEventListener('click', event => {
    const button = event.target.closest('[data-revoke-username]');
    if (!button) return;
    const warning = passwordSet && button.dataset.active === 'true'
      ? ' Текущий пароль также будет отключён.'
      : '';
    if (confirm('Отозвать доступ для ' + button.dataset.revokeUsername + '?' + warning)) {
      void manage('revoke', button.dataset.revokeUsername);
    }
  });
}
