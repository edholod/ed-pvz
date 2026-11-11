(() => {
  'use strict';

  const clock = document.getElementById('weather-clock');
  const date = document.getElementById('weather-date');
  const temperature = document.getElementById('weather-temp');
  const description = document.getElementById('weather-desc');
  const place = document.getElementById('weather-place');
  const button = document.getElementById('weather-location');
  const widget = document.querySelector('.weather-widget');
  const cacheKey = 'ed-pvz-weather-v2';
  const oldKey = 'ed-pvz-weather-v1';
  const refreshInterval = 10 * 60 * 1000;
  const weatherNames = {
    0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
    45: 'Туман', 48: 'Изморозь', 51: 'Морось', 53: 'Морось', 55: 'Морось',
    56: 'Ледяная морось', 57: 'Ледяная морось', 61: 'Небольшой дождь', 63: 'Дождь',
    65: 'Сильный дождь', 66: 'Ледяной дождь', 67: 'Ледяной дождь',
    71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежные зёрна',
    80: 'Ливень', 81: 'Ливень', 82: 'Сильный ливень', 85: 'Снегопад', 86: 'Снегопад',
    95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом'
  };
  let saved = null;
  let pending = null;
  let attemptedAt = 0;
  let locating = false;

  function tick() {
    const now = new Date();
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('edpvz-ui-settings-v1') || '{}') || {}; } catch {}
    clock.textContent = new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', ...(settings.seconds === false ? {} : { second: '2-digit' }),
      hour12: settings.time === '12'
    }).format(now);
    const dateOptions = settings.date === 'short'
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : settings.date === 'numeric'
        ? { day: '2-digit', month: '2-digit', year: 'numeric' }
        : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    date.textContent = new Intl.DateTimeFormat('ru-RU', dateOptions).format(now);
  }

  function validCoords(value) {
    return value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
      && Number.isFinite(value.lon) && Math.abs(value.lon) <= 180;
  }

  function readSaved() {
    const candidates = [];
    for (const storage of ['localStorage', 'sessionStorage']) {
      for (const key of [cacheKey, oldKey]) {
        try {
          const value = JSON.parse(window[storage].getItem(key));
          if (value?.optedIn && validCoords(value)) candidates.push(value);
        } catch {}
      }
    }
    return candidates.sort((a, b) => (b.savedAt || b.updated || 0) - (a.savedAt || a.updated || 0))[0] || null;
  }

  function persist() {
    saved.savedAt = Date.now();
    const payload = JSON.stringify(saved);
    for (const storage of ['localStorage', 'sessionStorage']) {
      try { window[storage].setItem(cacheKey, payload); } catch {}
    }
  }

  function updateWidgetTheme() {
    const now = new Date();
    let night = now.getHours() < 7 || now.getHours() >= 19;
    const sun = saved?.sun;
    if (sun && now >= sun.start && now < sun.end) night = now < sun.rise || now >= sun.set;
    widget.classList.toggle('is-night', night);
  }

  function showSaved() {
    temperature.textContent = saved?.temp || '—°';
    description.textContent = saved?.desc || 'Погода';
    updateWidgetTheme();
  }

  function readSun(data) {
    const day = data.daily?.time?.[0];
    const offset = data.utc_offset_seconds || 0;
    const localTime = time => Date.parse(time + 'Z') - offset * 1000;
    const start = localTime(day + 'T00:00');
    const rise = localTime(data.daily?.sunrise?.[0]);
    const set = localTime(data.daily?.sunset?.[0]);
    if (![start, rise, set].every(Number.isFinite)) return null;
    return { start, end: start + 24 * 60 * 60 * 1000, rise, set };
  }

  async function refreshWeather(force = false) {
    if (!saved || pending === saved) return;
    if (!force && Date.now() - Math.max(saved.updated || 0, attemptedAt) < refreshInterval) return;
    const location = saved;
    pending = location;
    attemptedAt = Date.now();
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude: location.lat.toFixed(2), longitude: location.lon.toFixed(2),
        current: 'temperature_2m,weather_code', daily: 'sunrise,sunset',
        timezone: 'auto', forecast_days: '1'
      });
      const response = await fetch(url, { cache: 'no-store', signal: globalThis.AbortSignal?.timeout?.(12000) });
      if (!response.ok) throw new Error('Погода недоступна');
      const data = await response.json();
      if (!Number.isFinite(data.current?.temperature_2m)) throw new Error('Нет данных о температуре');
      if (saved !== location) return;
      location.temp = Math.round(data.current.temperature_2m) + '°';
      location.desc = weatherNames[data.current.weather_code] || 'Текущая погода';
      location.updated = Date.now();
      location.sun = readSun(data);
      persist();
      showSaved();
      if (!locating) place.textContent = 'По сохранённому месту';
    } catch {
      if (saved === location && !locating) {
        place.textContent = saved.updated ? 'Последнее обновление погоды' : 'Место сохранено · погода недоступна';
      }
    } finally {
      if (pending === location) pending = null;
    }
  }

  function locate() {
    if (locating) return;
    if (!navigator.geolocation) {
      place.textContent = saved ? 'По сохранённому месту' : 'Геолокация недоступна';
      return;
    }
    locating = true;
    button.disabled = true;
    place.textContent = 'Определяем местоположение…';

    function finish() {
      locating = false;
      button.disabled = false;
    }

    function unavailable(error) {
      finish();
      if (saved) {
        place.textContent = 'По сохранённому месту';
        void refreshWeather();
      } else {
        place.textContent = error?.code === 1
          ? 'Разрешите геолокацию в настройках сайта'
          : 'Место не определено. Повторите попытку';
      }
    }

    try {
      navigator.geolocation.getCurrentPosition(position => {
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        if (!validCoords(coords)) return unavailable();
        finish();
        const lat = Number(coords.lat.toFixed(2));
        const lon = Number(coords.lon.toFixed(2));
        if (saved?.lat !== lat || saved?.lon !== lon) saved = { lat, lon, optedIn: true, updated: 0 };
        persist();
        showSaved();
        place.textContent = 'Местоположение сохранено';
        void refreshWeather(true);
      }, unavailable, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    } catch {
      unavailable();
    }
  }

  function onReturn() {
    if (document.hidden) return;
    tick();
    updateWidgetTheme();
    void refreshWeather();
  }

  tick();
  setInterval(tick, 1000);
  setInterval(onReturn, 60000);
  button.addEventListener('click', locate);
  window.addEventListener('pageshow', onReturn);
  window.addEventListener('focus', onReturn);
  window.addEventListener('online', () => { if (!document.hidden) void refreshWeather(true); });
  document.addEventListener('visibilitychange', onReturn);

  saved = readSaved();
  showSaved();
  if (saved) {
    persist();
    place.textContent = 'По сохранённому месту';
    void refreshWeather();
  } else {
    place.textContent = 'Нажмите «Моя погода»';
    navigator.permissions?.query?.({ name: 'geolocation' })?.then(permission => {
      if (permission.state === 'granted' && !saved && !document.hidden) locate();
    }).catch(() => {});
  }
})();
