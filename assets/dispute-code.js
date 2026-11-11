(() => {
  const account = window.EdPVZAccount;
  const input = document.getElementById('search');
  const mode = document.getElementById('dispute-password-mode');
  const panel = document.getElementById('dispute-code-panel');
  const status = document.getElementById('dispute-code-status');
  const submit = document.getElementById('dispute-code-submit');
  const section = document.getElementById('owner-disputes');
  const searchPlaceholder = input.placeholder;
  const validCode = /^PVZ-[0-9A-F]{32}$/i;
  let checkedUser = null;
  let lookup = 0;
  let passwordMode = false;

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
      // The owner page checks access independently on every request.
    }
  }

  function inspectInput() {
    if (passwordMode) {
      panel.hidden = false;
      submit.hidden = false;
      submit.textContent = 'Открыть удержания';
      status.textContent = 'Введи пароль, который тебе передали.';
      return;
    }
    const code = input.value.trim();
    panel.hidden = !/^PVZ-/i.test(code);
    submit.hidden = !validCode.test(code);
    submit.textContent = 'Активировать код';
    if (panel.hidden) return;
    document.getElementById('empty').classList.add('hidden');
    status.textContent = submit.hidden ? 'Введи код целиком.' : 'Код доступа к удержаниям.';
  }

  function setPasswordMode(enabled) {
    input.value = '';
    passwordMode = false;
    delete input.dataset.accessPassword;
    input.type = 'search';
    input.placeholder = searchPlaceholder;
    input.removeAttribute('aria-label');
    input.dispatchEvent(new Event('input'));
    passwordMode = enabled;
    if (enabled) {
      input.dataset.accessPassword = 'true';
      input.type = 'password';
      input.placeholder = 'Пароль к удержаниям';
      input.setAttribute('aria-label', 'Пароль к удержаниям');
      input.focus();
    }
    mode.setAttribute('aria-pressed', String(enabled));
    mode.textContent = enabled ? 'Вернуться к поиску' : 'Ввести пароль к удержаниям';
    inspectInput();
  }

  async function redeem() {
    const password = passwordMode;
    const value = password ? input.value : input.value.trim();
    if ((password ? !value : !validCode.test(value)) || submit.disabled) return;
    const uid = account.user?.id;
    if (!uid) {
      status.textContent = 'Войди в аккаунт собственника и повтори ввод.';
      return;
    }
    submit.disabled = true;
    mode.disabled = true;
    status.textContent = password ? 'Проверяем пароль…' : 'Проверяем код…';
    try {
      const result = password
        ? await account.rpc('edpvz_dispute_redeem_password', { p_password: value })
        : await account.rpc('edpvz_dispute_owner_access', { p_action: 'redeem', p_code: value });
      if (uid !== account.user?.id) return;
      if (result.error) throw new Error(result.error);
      setPasswordMode(false);
      lookup++;
      checkedUser = uid;
      section.hidden = false;
      panel.hidden = false;
      status.textContent = 'Доступ открыт. На главной появился раздел «Мои удержания».';
    } catch (error) {
      const messages = {
        invalid_password: 'Пароль не подошёл.',
        rate_limited: 'Слишком много попыток. Повтори через 10 минут.',
        invalid_code: 'Код недействителен, истёк или выдан другому аккаунту.',
        owner_account_required: 'Войди в аккаунт с ролью собственника.'
      };
      status.textContent = messages[error.message] || 'Не удалось открыть доступ. Попробуй ещё раз.';
    } finally {
      submit.disabled = false;
      mode.disabled = false;
    }
  }

  mode.addEventListener('click', () => setPasswordMode(!passwordMode));
  input.addEventListener('input', inspectInput);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (passwordMode || validCode.test(input.value.trim()))) {
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
