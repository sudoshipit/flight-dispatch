// These adapters operate only on the service's visible, authenticated page.
// No credentials, session cookies, internal endpoints, or API keys are scraped.
export function simbriefPageStep(expected, allowSubmit = true) {
  if (location.hostname !== 'dispatch.simbrief.com' || !location.pathname.startsWith('/options')) return { state: 'waiting', message: 'Sign in to SimBrief in your browser.' };
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const read = name => document.querySelector(`[name="${name}"]`)?.value?.trim().replace(/\s+/g, ' ').toUpperCase();
  for (const [name, value] of Object.entries(expected)) {
    const options = Array.isArray(value) ? value : name === 'fl' ? [value, 'FL' + Number(value) / 100, String(Number(value) / 100)] : [value];
    if (value !== null && !options.some(option => read(name) === String(option).toUpperCase())) return { state: 'waiting', message: 'Waiting for your requested flight options to load. Automatic generation will wait until the values match.' };
  }
  if (window.__flightDispatchGenerated) return { state: 'submitted', message: 'SimBrief is generating your flight.' };
  const button = [...document.querySelectorAll('button, a, [role="button"], [onclick], input[type="button"]')].find(el => visible(el) && /^(generate flight|generate flight plan|generate ofp)$/i.test((el.innerText || el.value || el.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim()) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled'));
  if (!button) return { state: 'waiting', message: 'Waiting for the SimBrief generation control.' };
  if (!allowSubmit) return { state: 'ready', message: 'Flight options verified. Starting automatic generation.' };
  window.__flightDispatchGenerated = true;
  button.click();
  return { state: 'submitted', message: 'SimBrief is generating your flight.' };
}

export function vatsimPageStep(expected, allowSubmit, submittedBefore, baselineStatus = '') {
  if (location.hostname !== 'my.vatsim.net' || !location.pathname.startsWith('/pilots/flightplan')) return { state: 'waiting', message: 'Sign in to VATSIM in your browser.' };
  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const norm = text => (text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  const controls = [...document.querySelectorAll('input, select, textarea')];
  const label = el => norm([...(el.labels || [])].map(l => l.textContent).join(' ') || el.getAttribute('aria-label') || (el.previousElementSibling?.tagName === 'LABEL' ? el.previousElementSibling.textContent : '') || el.closest('.form-group')?.querySelector('label')?.textContent || el.name || el.id);
  const find = pattern => controls.find(el => visible(el) && pattern.test(label(el)));
  const patterns = {
    callsign: /^callsign$/i, rules: /^flight rules/i, aircraft: /^aircraft type/i, wake: /^wake category/i,
    equipment: /^equipment/i, transponder: /^transponder/i, departure: /^departure$/i,
    arrival: /^arrival$/i, alternate: /^alternate$/i, offBlock: /^off block/i,
    altitude: /^altitude/i, speed: /^airspeed/i, enroute: /^enroute time/i,
    endurance: /^fuel endurance/i, voice: /^voice rules/i,
  };
  const mapped = {};
  for (const [key, pattern] of Object.entries(patterns)) mapped[key] = find(pattern);
  mapped.route = find(/^route( details)?$/i) || controls.find(el => visible(el) && el.tagName === 'TEXTAREA' && /route/i.test(el.name + el.id));
  if (!mapped.route) {
    const areas = controls.filter(el => visible(el) && el.tagName === 'TEXTAREA');
    if (areas.length === 1) mapped.route = areas[0];
  }
  const statusText = [...document.querySelectorAll('[role="alert"], .alert-success, .swal2-popup, .toast-success')].filter(visible).map(el => norm(el.innerText || el.textContent)).join(' ');
  const previousStatus = window.__flightDispatchBaseline ?? baselineStatus;
  if ((submittedBefore || window.__flightDispatchSubmitted) && statusText !== previousStatus && /(?:flight\s*plan.{0,80}(?:successfully|has been filed|filed successfully|\bfiled\b)|successfully.{0,50}(?:filed|flight\s*plan)|happy flying)/i.test(statusText) && !/\b(?:not|failed|unable|error|unsuccessful|cannot)\b/i.test(statusText)) return { state: 'confirmed', message: statusText.slice(0, 350) };
  if (submittedBefore || window.__flightDispatchSubmitted) {
    const errors = [...document.querySelectorAll('.alert-danger, .invalid-feedback, [role="alert"]')].filter(visible).map(el => norm(el.innerText || el.textContent)).filter(text => /error|failed|invalid|required|unable/i.test(text)).join(' ');
    return { state: errors ? 'error' : 'submitted', baselineStatus: previousStatus, message: errors.slice(0, 350) || 'Submitted once. Waiting for VATSIM confirmation; do not file again.' };
  }
  const missing = Object.keys(mapped).filter(key => !mapped[key]);
  if (missing.length) return { state: 'waiting', message: `Waiting for the VATSIM form (${missing.join(', ')}). Automatic filing is waiting for these controls.` };
  // Never overwrite a different flight which may already be open in the window.
  for (const key of ['callsign', 'departure', 'arrival']) if (mapped[key].value && mapped[key].value.toUpperCase() !== expected[key]) return { state: 'waiting', message: 'The VATSIM form does not match this flight. Automatic filing stopped to avoid filing the wrong flight.' };
  function set(el, value, key) {
    if (el.tagName === 'SELECT') {
      const option = [...el.options].find(o => key === 'wake' ? o.value === value || ({ L: /^light/i, M: /^medium/i, H: /^heavy/i, J: /^super/i }[value]?.test(norm(o.text))) : norm(o.text).toUpperCase() === value.toUpperCase() || o.value.toUpperCase() === value.toUpperCase());
      if (!option) return false;
      value = option.value;
    }
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    if (el.value !== value) {
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return el.value === value;
  }
  for (const [key, el] of Object.entries(mapped)) if (!set(el, expected[key], key)) return { state: 'error', message: `Could not set VATSIM ${key}. Automatic filing stopped.` };
  // All optional section 18 entries in the user's reference are blank.
  for (const el of controls) if (/^(PBN|NAV|DAT|SUR|DOF|REG|SEL|CODE|RVR|OPR|PER|RALT|TALT|ORGN|COM|EET|RMK)\s*\/$/i.test(label(el))) if (!set(el, '', 'other')) return { state: 'error', message: 'Could not clear optional VATSIM details.' };
  const button = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')].find(el => visible(el) && /^(file plan(?: \(FPL\))?|file flight\s*plan)$/i.test(norm(el.innerText || el.value || el.textContent)) && !el.disabled);
  if (!button) return { state: 'waiting', message: 'Automatic filing cannot find an enabled File Plan button.' };
  if (!allowSubmit) {
    if (!button.__flightDispatchListening) {
      button.__flightDispatchListening = true;
      button.addEventListener('click', () => { window.__flightDispatchBaseline = statusText; window.__flightDispatchSubmitted = true; }, { once: true });
    }
    return { state: 'ready', baselineStatus: statusText, message: 'VATSIM form verified. Preparing automatic submission.' };
  }
  const form = button.form || button.closest('form');
  if (form && !form.checkValidity()) return { state: 'error', message: 'VATSIM requires additional information. Review the highlighted fields in your browser.' };
  window.__flightDispatchSubmitted = true;
  window.__flightDispatchBaseline = statusText;
  button.click();
  return { state: 'submitted', baselineStatus: statusText, message: 'Submitted once. Waiting for VATSIM confirmation.' };
}
