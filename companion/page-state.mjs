// Read only the page's visible state. Never read passwords, cookies or tokens.
export function vatsimPageState() {
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const text = el => (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  const controls = [...document.querySelectorAll('button, a, input[type="submit"], [role="button"]')].filter(visible);
  if (/just a moment|verify you are human|attention required.*cloudflare/i.test(document.title) || visible(document.querySelector('#challenge-form'))) return { state: 'verification' };
  if (location.hostname !== 'my.vatsim.net') return { state: 'authentication' };
  // A ready filing form takes precedence over unrelated sign-in links or an
  // inactive/embedded verification widget elsewhere on an authenticated page.
  if (location.pathname.startsWith('/pilots/flightplan') && controls.some(el => /^(file plan(?: \(FPL\))?|file flight\s*plan)$/i.test(text(el)))) return { state: 'ready' };
  if ([...document.querySelectorAll('input[type="password"]')].some(visible) || controls.some(el => /^(?:sign\s*in|log\s*in)(?:\s+(?:to|with)\s+vatsim)?$/i.test(text(el)))) return { state: 'authentication' };
  if ([...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]')].some(visible)) return { state: 'verification' };
  if (/^\/(?:dashboard|home)?\/?$/.test(location.pathname) && controls.some(el => /log\s*out|sign\s*out/i.test(text(el)))) return { state: 'home' };
  return { state: 'loading' };
}
