const moscowTime = new Intl.DateTimeFormat('ru-RU', {
 timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
 hour: '2-digit', minute: '2-digit'
});

const freshnessWindow = 3 * 60 * 60 * 1000;

export function recentlyUpdated(scopes, keys, now = Date.now()) {
 const byKey = new Map(scopes.map(scope => [scope.scope, scope]));
 return keys.every(key => Date.parse(byKey.get(key)?.last_success) >= now - freshnessWindow);
}

export function updateTime(scopes, keys, now = Date.now()) {
 const byKey = new Map(scopes.map(scope => [scope.scope, scope]));
 const times = keys.map(key => Date.parse(byKey.get(key)?.last_success)).filter(Number.isFinite);
 if (!times.length) return 'Время последнего обновления пока неизвестно.';
 const format = time => moscowTime.format(time) + ' МСК';
 const latest = format(Math.max(...times));
 if (keys.length === 1) return 'Последнее обновление · ' + latest;
 const fresh = times.filter(time => time >= now - freshnessWindow).length;
 return 'Последнее обновление · ' + latest + '. За 3 часа обновлено разделов WB: ' + fresh + ' из ' + keys.length + '.';
}

export function holdingUpdateKeys(points, categories = ['hanging', 'brak', 'podmena']) {
 return points.flatMap(point => categories.map(category =>
  `wb:${point.organization_research_id}:${point.wb_point_id}:${category}:to-hold`));
}
