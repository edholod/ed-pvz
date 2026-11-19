export function setLoading(control, loading) {
  if (!control) return;
  control.disabled = loading;
  if (loading) control.setAttribute('aria-busy', 'true');
  else control.removeAttribute('aria-busy');
}

export function revealPlayer(panel) {
  const title = panel.querySelector('[data-player-title]');
  title?.focus({preventScroll:true});
  const bounds = panel.getBoundingClientRect();
  if (matchMedia('(max-width: 760px)').matches || bounds.top < 16 || bounds.top > innerHeight * .6) {
    panel.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
}
