import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../assets/weather-widget.js', import.meta.url), 'utf8');
const key = 'ed-pvz-weather-v2';
const now = Date.now();
const cached = { lat: 55.75, lon: 37.62, optedIn: true, temp: '4°', desc: 'Пасмурно', updated: now };
const currentWeather = async () => ({
  ok: true,
  json: async () => ({ current: { temperature_2m: 6, weather_code: 0 } })
});

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function launch({ local = storage(), session = storage(), geolocation, fetch = currentWeather } = {}) {
  const elements = new Map();
  const events = new Map();
  const window = {
    sessionStorage: session,
    get localStorage() {
      if (local === null) throw new Error('Storage blocked');
      return local;
    },
    addEventListener: (name, listener) => events.set(name, listener)
  };
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', disabled: false,
        addEventListener: (name, listener) => events.set(id + ':' + name, listener)
      });
      return elements.get(id);
    },
    querySelector: () => ({ classList: { toggle() {} } }),
    addEventListener() {},
    hidden: false
  };
  runInNewContext(source, {
    window, document, navigator: { geolocation }, fetch, URL, URLSearchParams,
    localStorage: local, setInterval() {}
  });
  return { text: id => elements.get('weather-' + id).textContent, events };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('restores coordinates and weather from session storage when local storage is blocked', () => {
  const app = launch({ local: null, session: storage({ [key]: JSON.stringify(cached) }) });
  assert.equal(app.text('temp'), '4°');
  assert.equal(app.text('place'), 'По сохранённому месту');
});

test('a denied location request keeps the saved place and temperature', () => {
  const app = launch({
    local: storage({ [key]: JSON.stringify(cached) }),
    geolocation: { getCurrentPosition(_success, error) { error({ code: 1 }); } }
  });
  app.events.get('weather-location:click')();
  assert.equal(app.text('temp'), '4°');
  assert.equal(app.text('place'), 'По сохранённому месту');
});

test('stores a newly granted location before fetching and restores it after reload', async () => {
  const session = storage();
  const offline = async () => { throw new Error('Offline'); };
  const app = launch({
    local: null, session, fetch: offline,
    geolocation: { getCurrentPosition(success) { success({ coords: { latitude: 55.7558, longitude: 37.6173 } }); } }
  });
  app.events.get('weather-location:click')();
  assert.equal(JSON.parse(session.getItem(key)).lat, 55.76);
  await flush();
  const reopened = launch({ local: null, session, fetch: currentWeather });
  await flush();
  assert.equal(reopened.text('temp'), '6°');
});

test('retains the last temperature while offline and refreshes when the connection returns', async () => {
  let connected = false;
  const app = launch({
    local: storage({ [key]: JSON.stringify({ ...cached, updated: 1 }) }),
    fetch: async () => { if (!connected) throw new Error('Offline'); return currentWeather(); }
  });
  await flush();
  assert.equal(app.text('temp'), '4°');
  connected = true;
  app.events.get('online')();
  await flush();
  assert.equal(app.text('temp'), '6°');
});
