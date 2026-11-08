(function (root) {
  'use strict';
  function createLoader(fetcher) {
    return async function loadWBNews() {
      const get = async url => {
        const response = await fetcher(url, {cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('HTTP '+response.status);
        return response.json();
      };
      try {
        const config = await get('../../data/wb-news-config.json?t='+Date.now());
        if (!config.enabled || !config.endpoint) return {items:[],message:'Мой ПВЗ: облачный сервер ещё не подключён.'};
        const endpoint = new URL(config.endpoint);
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Некорректный адрес сервера');
        const base = endpoint.href.replace(/\/$/,'');
        const data = await get(base+'/api/news');
        if (!Array.isArray(data.items)) throw Error('Некорректный формат новостей');
        const items = data.items.filter(item => item && item.origin==='my-pvz' && typeof item.title==='string' && typeof item.content==='string' && /^https:\/\/my-pvz\.wb\.ru\/news\/(owners|employees)(?:#|$)/.test(item.url));
        const state = data.status?.state;
        const message = state==='authentication_required' || state==='manual_login'
          ? 'Мой ПВЗ: нужен повторный вход владельца. Показываем ранее полученные новости.'
          : state==='blocked' ? 'Мой ПВЗ: WB приостановил доступ. Показываем сохранённые новости.'
          : state!=='ok' ? 'Мой ПВЗ: обновление временно ограничено. Показываем сохранённые новости.'
          : 'Мой ПВЗ: подключён · проверка каждые 15 минут · публикаций: '+items.length;
        return {items,message,updated:data.updated};
      } catch { return {items:[],message:'Мой ПВЗ: сервер временно недоступен или требуется первый вход. Публичная лента продолжает работать.'}; }
    };
  }
  if (typeof module!=='undefined' && module.exports) module.exports={createLoader};
  else root.EdWBNews={load:createLoader(root.fetch.bind(root))};
})(typeof window!=='undefined'?window:globalThis);
