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
        if (!config.enabled || (config.mode!=='github-actions' && !config.endpoint)) return {items:[],message:'Мой ПВЗ: облачный сервер ещё не подключён.'};
        let apiURL;
        if(config.mode==='github-actions') apiURL='https://raw.githubusercontent.com/edholod/ed-pvz/main/data/wb-news.json?t='+Date.now();
        else {
          const endpoint = new URL(config.endpoint);
          if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Некорректный адрес сервера');
          apiURL=endpoint.href.replace(/\/$/,'')+'/api/news';
        }
        const data = await get(apiURL);
        if (!Array.isArray(data.items)) throw Error('Некорректный формат новостей');
        const items = data.items.filter(item => item && item.origin==='my-pvz' && typeof item.title==='string' && typeof item.content==='string' && /^https:\/\/my-pvz\.wb\.ru\/news\/(owners|employees)(?:#|$)/.test(item.url));
        const state = data.status?.state;
        const message = state==='missing_session' || state==='invalid_session' ? 'Мой ПВЗ: расписание настроено, но требуется добавить действующую сессию WB.' : state==='authentication_required' || state==='manual_login'
          ? 'Мой ПВЗ: нужен повторный вход владельца. Показываем ранее полученные новости.'
          : state==='blocked' ? 'Мой ПВЗ: WB приостановил доступ. Показываем сохранённые новости.'
          : state==='access_denied' ? 'Мой ПВЗ: новости недоступны выбранной организации. Требуется проверить доступ в кабинете WB.'
          : state!=='ok' ? 'Мой ПВЗ: обновление временно ограничено. Показываем сохранённые новости.'
          : 'Мой ПВЗ: подключён · проверка каждые '+(data.status?.intervalMinutes||15)+' минут · публикаций: '+items.length;
        return {items,message,updated:data.updated};
      } catch { return {items:[],message:'Мой ПВЗ: сервер временно недоступен или требуется первый вход. Публичная лента продолжает работать.'}; }
    };
  }
  if (typeof module!=='undefined' && module.exports) module.exports={createLoader};
  else root.EdWBNews={load:createLoader(root.fetch.bind(root))};
})(typeof window!=='undefined'?window:globalThis);
