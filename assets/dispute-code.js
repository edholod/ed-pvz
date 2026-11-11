(() => {
  const account = window.EdPVZAccount;
  const input = document.getElementById('search');
  const panel = document.getElementById('dispute-code-panel');
  const status = document.getElementById('dispute-code-status');
  const submit = document.getElementById('dispute-code-submit');
  const section = document.getElementById('owner-disputes');
  const validCode = /^PVZ-[0-9A-F]{32}$/i;
  let checkedUser = null;
  let lookup = 0;

  async function refreshAccess() {
    const uid = account.user?.id || null;
    if (uid !== checkedUser) section.hidden = true;
    checkedUser = uid;
    const version = ++lookup;
    if (!uid) return;
    try {
      const access = await account.rpc('edpvz_dispute_owner_access', { p_action: 'list' });
      if (version === lookup && uid === account.user?.id) section.hidden = access.length === 0;
    } catch {
      // A temporary outage does not change access. The owner page verifies it on every request.
    }
  }

  function inspectInput() {
    const code = input.value.trim();
    panel.hidden = !/^PVZ-/i.test(code);
    submit.hidden = !validCode.test(code);
    if (panel.hidden) return;
    document.getElementById('empty').classList.add('hidden');
    status.textContent = submit.hidden ? 'Введи код целиком.' : 'Код доступа к удержаниям.';
  }

  async function redeem() {
    const code = input.value.trim();
    if (!validCode.test(code) || submit.disabled) return;
    const uid = account.user?.id;
    if (!uid) {
      status.textContent = 'Войди в аккаунт собственника и введи код ещё раз.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Проверяем код…';
    try {
      await account.rpc('edpvz_dispute_owner_access', { p_action: 'redeem', p_code: code });
      if (uid !== account.user?.id) return;
      input.value = '';
      input.dispatchEvent(new Event('input'));
      lookup++;
      checkedUser = uid;
      section.hidden = false;
      panel.hidden = false;
      status.textContent = 'Доступ открыт. На главной появился раздел «Мои удержания».';
    } catch (error) {
      status.textContent = error.message === 'invalid_code'
        ? 'Код недействителен, истёк или выдан другому аккаунту.'
        : error.message === 'owner_account_required'
          ? 'Войди в аккаунт с ролью собственника.'
          : 'Не удалось активировать код. Попробуй ещё раз.';
    } finally {
      submit.disabled = false;
    }
  }

  input.addEventListener('input', inspectInput);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && validCode.test(input.value.trim())) {
      event.preventDefault();
      void redeem();
    }
  });
  submit.addEventListener('click', redeem);
  window.addEventListener('edpvz-auth-changed', refreshAccess);
  window.addEventListener('pageshow', refreshAccess);
  window.addEventListener('focus', refreshAccess);
  void refreshAccess();
})();
