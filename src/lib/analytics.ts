/** Non-personal funnel events. A reporting integration may listen to this event. */
export function trackEvent(name: string, properties: Record<string, string | number | boolean> = {}) {
  if (typeof window === 'undefined') return;
  // Explicit allowlists keep free text, addresses, query strings and chat out.
  const allowed = new Set(['mode', 'step', 'service', 'reason', 'locale', 'method', 'source', 'open', 'expanded']);
  const safe = Object.fromEntries(Object.entries(properties).filter(([key, value]) =>
    allowed.has(key) && (typeof value !== 'string' || /^[a-z0-9_-]{1,60}$/i.test(value))));
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(name)) return;
  window.dispatchEvent(new CustomEvent('enztronic:analytics', { detail: { name, properties: safe } }));
}
