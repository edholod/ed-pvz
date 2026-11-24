const form = document.getElementById('settings');
const status = document.getElementById('status');
const save = document.getElementById('save');
const probes = [...form.querySelectorAll('[data-probe]')];
const request = data => window.EdPVZAI.request({section: 'admin', ...data});
const providerLabel = {alice: 'Алиса AI', gemini: 'Gemini'};
const fmt = date => new Date(date).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'});

async function load() {
  const {settings, stats, cooldowns, configured, aliceBillingApproved, geminiTermsVerified} = await request({action: 'status'});
  for (const [key, val] of Object.entries(settings)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = val;
    else field.value = val;
  }
  const eligible = new Set();
  for (const button of probes) {
    const key = button.dataset.probe;
    const cooldown = cooldowns.find(c => c.provider === key && Date.parse(c.until_at) > Date.now());
    if (configured[key] && settings[key+'_enabled'] && !cooldown) eligible.add(key);
    document.getElementById(key+'-status').textContent = !configured[key] ? (key === 'alice' && !aliceBillingApproved ? 'Ожидает подтверждения платного API' : key === 'gemini' && !geminiTermsVerified ? 'Ожидает проверки условий использования Gemini' : 'Ожидает API-ключ')
      : !settings[key+'_enabled'] ? 'Выключен' : cooldown ? 'Пауза до '+fmt(cooldown.until_at) : 'Настроен';
    button.disabled = !configured[key];
  }
  const current = [settings.primary_provider, ...Object.keys(providerLabel)].find(key => eligible.has(key));
  status.textContent = settings.enabled ? (current ? 'Провайдер для следующего запроса — '+providerLabel[current] : 'Доступных провайдеров пока нет.') : 'Эд ИИ выключен.';
  const periods = document.getElementById('periods');
  periods.replaceChildren();
  for (const item of stats.periods) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = item.label;
    card.append(title, document.createTextNode(`${item.requests} запросов · ${item.successes} успешных · ${item.failures} с ошибкой · ${item.tokens} учтённых токенов · ${item.switches} переключений`));
    periods.append(card);
  }
  document.getElementById('recent').textContent = stats.recent.map(item =>
    [fmt(item.started_at), item.outcome, ...item.attempts.map(a=>(providerLabel[a.provider] || a.provider)+' '+a.status)].join(' · ')
  ).join('\n') || 'Запросов пока нет.';
  form.hidden = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  save.disabled = true;
  try {
    const settings = {};
    for (const field of form.querySelectorAll('[name]')) {
      settings[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? field.valueAsNumber : field.value;
    }
    await request({action: 'save', settings});
    await load();
  } catch (error) {
    status.textContent = error.message;
  } finally { save.disabled = false; }
});
for (const button of probes) button.onclick = async () => {
  button.disabled = true;
  const provider = button.dataset.probe;
  const line = document.getElementById(provider+'-status');
  line.textContent = 'Проверяем сохранённую модель…';
  try {
    const result = await request({action: 'probe', provider});
    line.textContent = result.ok ? 'Проверочный запрос успешен' : 'Проверка завершилась: '+result.status;
  } catch (error) { line.textContent = error.message; }
  finally { button.disabled = false; }
};
load().catch(error => {status.textContent = error.message;});
