const $ = id => document.getElementById(id);
const panel = $('owner-invite');
let organization = null;
let requestNumber = 0;

const messages = {
  owner_not_found: 'Аккаунт собственника с таким логином не найден.',
  access_already_active: 'Сначала отзови действующий доступ к этому собственнику.'
};

function render(result) {
  const active = result.state === 'active';
  const date = result.expires_at && new Date(result.expires_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  const labels = {
    none: 'Код для этой группы ПВЗ ещё не создан.',
    pending: 'Код для ' + result.username + ' действует до ' + date + '.',
    active: 'Доступ активирован для ' + result.username + '.',
    expired: 'Срок действия кода истёк.'
  };
  $('invite-state').textContent = labels[result.state];
  $('invite-form').hidden = active;
  $('invite-revoke').hidden = result.state === 'none';
  $('invite-revoke').textContent = active ? 'Отозвать доступ' : 'Отменить код';
  $('invite-code-box').hidden = !result.code;
  $('invite-code').value = result.code || '';
}

async function manage(action, username) {
  if (!organization) return;
  const version = ++requestNumber;
  const form = $('invite-form');
  const revoke = $('invite-revoke');
  form.querySelector('button').disabled = true;
  revoke.disabled = true;
  $('invite-error').textContent = '';
  try {
    const result = await window.EdPVZAccount.rpc('edpvz_dispute_manage_access', {
      p_org: organization, p_action: action, p_username: username || null
    });
    if (version === requestNumber) render(result);
  } catch (error) {
    if (version === requestNumber) {
      $('invite-error').textContent = messages[error.message] || 'Операция не выполнена. Попробуй ещё раз.';
    }
  } finally {
    if (version === requestNumber) {
      form.querySelector('button').disabled = false;
      revoke.disabled = false;
    }
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
  $('invite-revoke').hidden = true;
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
  $('invite-revoke').addEventListener('click', () => {
    if (confirm('Отозвать код или доступ к этой группе ПВЗ?')) void manage('revoke');
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
