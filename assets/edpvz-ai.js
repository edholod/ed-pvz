(() => {
  const endpoint = 'https://duerixyhzapotoeclggz.supabase.co/functions/v1/edpvz-ai';
  const apikey = 'sb_publishable_fKE2S2rAz7VMa54rgO4uvQ_vyzFPwmV';
  const messages = {
    sign_in: 'Войдите в «Эд ПВЗ», чтобы использовать Эд ИИ.',
    private_input: 'Уберите личные данные и закрытые сведения из описания.',
    limit: 'Лимит Эд ИИ исчерпан или запрос уже обрабатывается.',
    duplicate: 'Этот запрос уже обработан.',
    disabled: 'Эд ИИ сейчас отключён.',
    forbidden: 'Раздел доступен только администратору.',
  };
  window.EdPVZAI = {
    async request(input, {signal} = {}) {
      const session = await window.EdPVZAccount?.ensure();
      if (!session?.access_token) throw new Error(messages.sign_in);
      const response = await fetch(endpoint, {
        method: 'POST', signal,
        headers: {apikey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json'},
        body: JSON.stringify({requestId: crypto.randomUUID(), ...input}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messages[result.error] || 'Эд ИИ временно недоступен.');
      return result;
    },
  };
})();
