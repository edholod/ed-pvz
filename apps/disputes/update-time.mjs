const moscowTime = new Intl.DateTimeFormat('ru-RU', {
 timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
 hour: '2-digit', minute: '2-digit'
});

export function updateTime(scopes, keys) {
 const byKey = new Map(scopes.map(scope => [scope.scope, scope]));
 const times = keys.map(key => Date.parse(byKey.get(key)?.last_success)).filter(Number.isFinite);
 if (!times.length) return 'Время последнего обновления пока неизвестно.';
 const complete = times.length === keys.length;
 const time = complete ? Math.min(...times) : Math.max(...times);
 return (complete ? 'Последнее обновление' : 'Последнее частичное обновление') + ' · ' + moscowTime.format(time) + ' МСК';
}

export function holdingUpdateKeys(points, categories = ['hanging', 'brak', 'podmena']) {
 return points.flatMap(point => categories.map(category =>
  `wb:${point.organization_research_id}:${point.wb_point_id}:${category}:to-hold`));
}
