import { app, BrowserWindow, ipcMain, shell, safeStorage, Notification, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Store } from './store.mjs';
import { Services } from './services.mjs';
import { validateFlight, simbriefUrl, matchGeneratedPlan, vatsimUrl, vatsimFields, planningParameters, parseOFP } from '../shared/domain.mjs';
import { readSimbriefFlights, readSimbriefXmlLink, parseSimbriefXml } from './simbrief-import.mjs';
import { simbriefPageStep } from './automation.mjs';
import { BrowserSessions, LOGIN_URLS } from './browser.mjs';
import { VatsimBridge } from './vatsim-bridge.mjs';
import { Telemetry } from './telemetry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.env.FLIGHT_DISPATCH_TEST_DATA) app.setPath('userData', process.env.FLIGHT_DISPATCH_TEST_DATA);
let main, store, services, browser, vatsim, telemetry, active = null;
let importChoices = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const emit = (stage, message, extra = {}) => { if (!main?.isDestroyed()) main.webContents.send('dispatch:progress', { stage, message, ...extra }); };
const browserOptions = operation => ({ isCancelled: () => operation.cancelled, onWaiting: message => emit('sign-in', message) });

async function prepareBrowser(tab, operation) {
  if (tab.isDestroyed()) throw new Error('The sign-in browser was closed. Try the dispatch again after signing in.');
  if (await tab.needsLogin()) {
    await browser.authenticate(tab, browserOptions(operation));
    emit(tab.name === 'vatsim' ? 'filing' : 'generating', 'Browser closed. Resuming automatic dispatch with your saved session.');
    return false;
  }
  await tab.resumeAfterLogin();
  return !operation.cancelled;
}
async function filePlan(plan, operation, autoSubmit) {
  let result;
  try { result = await submitPlan(plan, operation, autoSubmit); }
  catch (error) {
    const saved = store.getPlan(plan.id);
    result = store.savePlan({ ...saved, filing: { status: saved.filing.status === 'unconfirmed' ? 'unconfirmed' : 'failed', message: error.message } });
  }
  if (result.filing.status !== 'filed') {
    emit('filing-failed', result.filing.message, { plan: result });
    if (!process.env.FLIGHT_DISPATCH_TEST_DATA && Notification.isSupported()) new Notification({ title: result.filing.status === 'unconfirmed' ? 'VATSIM filing not confirmed' : 'VATSIM filing failed', body: `${result.callsign}: ${result.filing.message}`, silent: false }).show();
  }
  return result;
}
async function submitPlan(plan, operation, autoSubmit) {
  const url = vatsimUrl(plan);
  // Opening a prefilled form is not evidence of filing.
  plan = store.savePlan({ ...plan, filing: { status: 'pending', message: 'Waiting for the VATSIM connection and filing.' } });
  await vatsim.waitForConnection({ isCancelled: () => operation.cancelled, onWaiting: message => emit('connecting', message) });
  const { tabId } = await vatsim.request('open', { url });
  emit('filing', 'Opening your VATSIM flight plan in the background.', { serviceUrl: url, plan });
  const started = Date.now();
  let submitted = false, last = '', baselineStatus = '', waitingSince = Date.now(), submittedAt = 0, prompted = '', promptSince = 0;
  while (!operation.cancelled && Date.now() - started < 10 * 60000) {
    if (!submitted) {
      const state = await vatsim.request('state', { tabId });
      if (['authentication','verification'].includes(state?.state)) {
        if (!prompted) { await vatsim.request('show', { tabId }); promptSince = Date.now(); }
        prompted = state.state;
        emit(state.state === 'authentication' ? 'vatsim-sign-in' : 'verification', state.state === 'authentication' ? 'Sign in to VATSIM in your browser. Keep this browser open; filing resumes automatically.' : 'VATSIM requires browser verification. Your saved sign-in may still be valid. Complete verification in the browser; filing resumes in the same tab.');
        if (state.state === 'verification' && Date.now() - promptSince > 120000) throw new Error('VATSIM browser verification did not complete. No flight plan was submitted. Check the visible VATSIM tab before retrying.');
        await sleep(1800); continue;
      }
      if (state?.state !== 'ready') {
        if (Date.now() - waitingSince > 60000 && !prompted) throw new Error('The VATSIM filing form did not become ready. Check the browser tab and try again.');
        await sleep(1800); continue;
      }
      if (prompted) { await vatsim.request('background', { tabId }); prompted = ''; waitingSince = Date.now(); if (!process.env.FLIGHT_DISPATCH_TEST_DATA) { main.show(); main.focus(); } }
    }
    let result = await vatsim.request('step', { tabId, fields: vatsimFields(plan), allowSubmit: false, submitted, baseline: baselineStatus });
    if (result?.state === 'ready' && autoSubmit && !operation.cancelled) {
      // Persist the intent BEFORE clicking. A navigation, process crash, or
      // lost renderer response must never cause an automatic second filing.
      baselineStatus = result.baselineStatus || '';
      submitted = true; submittedAt = Date.now();
      plan = store.savePlan({ ...plan, filing: { status: 'unconfirmed', message: 'Filing attempt started. Awaiting VATSIM confirmation.' } });
      emit('filing', 'Submitting your plan to VATSIM.', { plan });
      result = await vatsim.request('step', { tabId, fields: vatsimFields(plan), allowSubmit: true, submitted: false, baseline: baselineStatus });
    }
    if (result?.state === 'submitted' && !submitted) {
      submitted = true;
      baselineStatus = result.baselineStatus || '';
      plan = store.savePlan({ ...plan, filing: { status: 'unconfirmed', message: 'Submitted. Awaiting confirmation from VATSIM.' } });
    }
    if (result?.message && result.message !== last) { last = result.message; waitingSince = Date.now(); emit('filing', last); }
    if (result?.state === 'waiting' && !submitted && Date.now() - waitingSince > 45000) { last = `Automatic filing failed: ${last}`; break; }
    if (result?.state === 'confirmed') {
      plan = store.savePlan({ ...plan, filing: { status: 'filed', confirmedAt: new Date().toISOString(), message: result.message } });
      await vatsim.request('close', { tabId }).catch(() => {});
      return plan;
    }
    if (result?.state === 'error') { last = result.message; break; }
    if (submitted && submittedAt && Date.now() - submittedAt > 60000) { last = ''; break; }
    await sleep(1800);
  }
  return store.savePlan({ ...plan, filing: { status: submitted ? 'unconfirmed' : 'failed', message: submitted ? `${last && /error|failed|invalid|required|unable|could not/i.test(last) ? last + ' ' : ''}Filing was attempted, but confirmation was not received. Check VATSIM before filing again.` : last || 'Automatic filing did not complete. Check the connection, then retry from the briefing.' } });
}
async function generate(input) {
  if (!store.settings().simbriefId) throw new Error('Enter your SimBrief Pilot ID or username in Settings and save preferences first.');
  if (active) throw new Error('A dispatch is already in progress. Cancel it before starting another.');
  const operation = { cancelled: false }; active = operation;
  let plan;
  try {
    const catalog = await services.aircraft();
    const flight = validateFlight(input, catalog.aircraft, store.settings().rules);
    emit('generating', 'Connecting to SimBrief in the background.');
    let previousId = '';
    try { previousId = (await services.ofp()).id; } catch { /* A first-time user may have no previous OFP. */ }
    if (operation.cancelled) throw new Error('Dispatch cancelled.');
    const started = Date.now(), staticId = `FD_${crypto.randomUUID().replace(/-/g, '')}`;
    const serviceUrl = simbriefUrl(flight, staticId);
    const win = await browser.open('simbrief', serviceUrl, browserOptions(operation));
    emit('generating', 'Loading your flight options in the background.', { serviceUrl });
    let lastPoll = 0, lastMessage = '';
    while (!operation.cancelled && Date.now() - started < 15 * 60000) {
      if (!await prepareBrowser(win, operation)) { await sleep(1800); continue; }
      const expected = { airline: flight.airline, fltnum: flight.flightNumber, orig: flight.origin, dest: flight.destination, type: flight.variant };
      if (flight.route) expected.route = flight.route;
      Object.assign(expected, planningParameters(flight));
      expected.pax = flight.passengerMode === 'auto' ? ['', 'AUTO'] : String(flight.passengerMode === 'full' ? flight.maxPassengers : flight.passengers);
      if (flight.costIndex !== null) { expected.cruisemode = 'CI'; expected.cruisesub = String(flight.costIndex); }
      let step = await win.step(simbriefPageStep, [expected, false]);
      if (step?.state === 'ready') {
        if (!operation.cancelled) step = await win.step(simbriefPageStep, [expected, true]);
      }
      if (step?.message && step.message !== lastMessage) { lastMessage = step.message; emit('generating', step.message); }
      if (Date.now() - lastPoll >= 10000) {
        lastPoll = Date.now();
        try {
          const candidate = await services.ofp(staticId);
          if (matchGeneratedPlan(candidate, flight, started, previousId, staticId)) { plan = store.savePlan({ ...candidate, requestedRoute: flight.route, variantId: flight.variant, variantName: flight.variantName, planningInput: { ...input, ...Object.fromEntries(['taxiOut','taxiIn','extraFuel','altitude'].map(key => [key, flight[key] == null ? '' : String(flight[key])])) } }); break; }
        } catch { /* Retry bounded, low-frequency polling during generation. */ }
      }
      await sleep(1800);
    }
    if (!plan) throw new Error(operation.cancelled ? 'Dispatch cancelled. Any plan generated on SimBrief is still available there.' : 'Timed out waiting for a matching plan. Check SimBrief, then use Import latest.');
    if (!win.isDestroyed()) await win.close();
    telemetry.follow(plan.id, { replaceWaiting: true });
    emit('generated', 'Flight plan generated. Preparing your briefing.', { plan });
    const enrichment = services.enrich(plan);
    if (store.settings().autoFile && !operation.cancelled) plan = await filePlan(plan, operation, true);
    const details = await enrichment;
    plan = store.getPlan(plan.id);
    emit('complete', plan.filing.status === 'filed' ? 'Flight plan filed. Your briefing is ready.' : 'Your briefing is ready. VATSIM filing is incomplete.', { plan, details });
    return { plan, details };
  } finally { active = null; await browser.close(); }
}
function allowedExternal(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ['dispatch.simbrief.com','www.simbrief.com','my.vatsim.net','www.flightaware.com','flightaware.com','aviationstack.com','www.southwest.com','www.delta.com'].includes(u.hostname); } catch { return false; }
}
async function briefingResult(plan) {
  const details = await services.enrich(plan);
  // Recording can advance while weather/gate lookups are pending.
  return { plan: store.getPlan(plan.id), details };
}
async function saveImportedPlan(imported) {
  const existing = store.read('history', []).find(p => p.id === imported.id && p.raw === imported.raw && p.offBlock === imported.offBlock);
  const plan = store.savePlan(existing ? { ...imported, filing: existing.filing, requestedRoute: existing.requestedRoute, planningInput: existing.planningInput, variantId: existing.variantId, variantName: existing.variantName, landing: existing.landing, actual: existing.actual } : imported);
  telemetry.follow(plan.id, { replaceWaiting: true });
  return briefingResult(plan);
}
async function readImportPage(url, reader, operation) {
  const tab = await browser.open('simbrief', url, browserOptions(operation));
  let readySince = Date.now();
  while (!operation.cancelled) {
    if (!await prepareBrowser(tab, operation)) { readySince = Date.now(); continue; }
    // Unlike generation, reader errors must be surfaced rather than retried.
    if (new URL(tab.page.url()).hostname === 'dispatch.simbrief.com') {
      const value = await tab.page.evaluate(reader);
      if (value !== null) return { tab, value };
    }
    if (Date.now() - readySince > 60000) throw new Error('SimBrief did not load the saved flight data. Refresh the list or use Import latest.');
    await sleep(1000);
  }
  throw new Error('SimBrief import cancelled.');
}

async function start() {
await app.whenReady();
app.setAppUserModelId('com.flightdispatch.desktop');
store = new Store(path.join(app.getPath('userData'), 'data'), safeStorage);
services = new Services(store);
browser = new BrowserSessions(path.join(app.getPath('userData'), 'browser-profile'), () => store.settings().browser);
vatsim = new VatsimBridge(root, app.getPath('userData'), process.env.FLIGHT_DISPATCH_TEST_DATA ? { port: Number(process.env.FLIGHT_DISPATCH_TEST_PORT || 0) } : {});
try { await vatsim.start(); } catch { vatsim.error = 'The local VATSIM connection could not start. Close other copies of Flight Dispatch and restart.'; }
main = new BrowserWindow({ width: 1380, height: 940, minWidth: 1000, minHeight: 720, show: !process.env.FLIGHT_DISPATCH_TEST_DATA, title: 'Flight Dispatch', backgroundColor: '#11171b', autoHideMenuBar: true, icon: path.join(root, 'assets/icon.png'), webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
if (process.platform === 'win32' && app.isPackaged) {
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  main.setAppDetails({ appId: 'com.flightdispatch.desktop', appIconPath: executable, appIconIndex: 0, relaunchCommand: `"${executable}"`, relaunchDisplayName: 'Flight Dispatch' });
}
main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
main.webContents.on('will-navigate', event => event.preventDefault());
telemetry = new Telemetry(store, value => {
  if (!main.isDestroyed()) main.webContents.send('dispatch:telemetry', value);
});
function handle(channel, fn) {
  ipcMain.handle(`dispatch:${channel}`, async (event, ...args) => {
    if (event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('Untrusted caller.');
    return fn(...args);
  });
}
handle('bootstrap', () => ({ settings: store.publicSettings(), history: store.read('history', []), version: app.getVersion(), telemetry: telemetry.status() }));
handle('telemetry-start', (id, config) => telemetry.start(id, config));
handle('telemetry-switch', (id, config) => telemetry.switchTo(id, config));
handle('telemetry-follow', id => telemetry.follow(id));
handle('telemetry-stop', () => telemetry.stop());
handle('catalog', refresh => services.aircraft(refresh === true));
handle('airport-positions', ids => services.airportPositions(ids));
handle('settings', async input => { if (active) throw new Error('Wait until the current dispatch finishes before changing settings.'); const old = store.settings().browser; if (input.browser !== old && browser.interactive && !browser.interactive.closed) throw new Error('Close the Flight Dispatch browser windows before switching browsers.'); const saved = store.saveSettings(input); if (old !== saved.browser) await browser.close(); return saved; });
handle('import', async () => {
  if (active) throw new Error('Wait until the current dispatch finishes.');
  const operation = { cancelled: false }; active = operation;
  try {
    const imported = await services.ofp();
    if (operation.cancelled) throw new Error('SimBrief import cancelled.');
    return await saveImportedPlan(imported);
  } finally { active = null; }
});
handle('simbrief-flights', async () => {
  if (active) throw new Error('Wait until the current dispatch finishes.');
  const operation = { cancelled: false }; active = operation; importChoices.clear();
  try {
    emit('importing', 'Loading saved SimBrief flight plans in the background.');
    const { value } = await readImportPage('https://dispatch.simbrief.com/flights/all#flights-history', readSimbriefFlights, operation);
    if (operation.cancelled) throw new Error('SimBrief import cancelled.');
    importChoices = new Map(value.map(item => [item.id, item]));
    return value;
  } finally { await browser.close(); active = null; }
});
handle('import-selected', async id => {
  if (active) throw new Error('Wait until the current dispatch finishes.');
  const choice = typeof id === 'string' && importChoices.get(id);
  if (!choice) throw new Error('Refresh the SimBrief flight list and select a flight.');
  const operation = { cancelled: false }; active = operation;
  try {
    emit('importing', `Importing ${choice.callsign} from SimBrief.`);
    const { tab, value: url } = await readImportPage(`https://dispatch.simbrief.com/briefing/${encodeURIComponent(id)}`, readSimbriefXmlLink, operation);
    const xml = await services.ofpFile(url);
    const imported = parseOFP(await tab.page.evaluate(parseSimbriefXml, xml));
    if (imported.id !== id || imported.callsign !== choice.callsign || imported.origin.icao !== choice.origin || imported.destination.icao !== choice.destination) throw new Error('SimBrief returned a different flight. Refresh the list and select the plan again.');
    if (operation.cancelled) throw new Error('SimBrief import cancelled.');
    return await saveImportedPlan(imported);
  } finally { await browser.close(); active = null; }
});
handle('sync-airframes', async base => {
  if (!store.settings().simbriefId) throw new Error('Enter your SimBrief Pilot ID or username in Settings and save preferences first.');
  if (active) throw new Error('Wait for the current dispatch to finish.');
  const catalog = await services.aircraft();
  if (!catalog.aircraft.some(a => a.id === base)) throw new Error('Choose an aircraft first.');
  const operation = { cancelled: false }; active = operation;
  try {
    emit('syncing', 'Checking your saved SimBrief airframes in the background.');
    const tab = await browser.open('simbrief', `https://dispatch.simbrief.com/options/custom?type=${encodeURIComponent(base)}`, browserOptions(operation));
    const started = Date.now();
    while (!operation.cancelled && Date.now() - started < 10 * 60000) {
      if (await prepareBrowser(tab, operation)) {
        const variants = await tab.readAirframes(base);
        if (variants) {
          const saved = store.read('personal-airframes', {}), id = store.settings().simbriefId;
          saved[id] = { ...saved[id], [base]: variants };
          store.write('personal-airframes', saved);
          await browser.close();
          return services.aircraft();
        }
      }
      await sleep(1800);
    }
    throw new Error(operation.cancelled ? 'Airframe sync cancelled.' : 'Could not load your airframes. Sign in to SimBrief in Settings and try again.');
  } finally { active = null; await browser.close(); }
});
handle('generate', generate);
handle('cancel', () => { if (active) active.cancelled = true; return true; });
handle('refresh', async (id, kind) => { const plan = store.getPlan(String(id)); return kind === 'weather' ? services.weather(plan) : kind === 'gates' ? services.gates(plan) : services.enrich(plan); });
handle('file', async id => {
  if (active) throw new Error('Another dispatch is in progress.');
  const plan = store.getPlan(String(id));
  if (plan.filing.status === 'filed' || plan.filing.status === 'unconfirmed') { await openVatsim(vatsimUrl(plan)); return briefingResult(plan); }
  const operation = { cancelled: false }; active = operation;
  try { const filed = await filePlan(plan, operation, true); return await briefingResult(filed); }
  finally { active = null; await browser.close(); }
});
handle('open', async url => {
  if (!allowedExternal(url)) throw new Error('This link is not an approved service URL.');
  if (active) throw new Error('Finish or cancel the current dispatch before opening a service page.');
  const host = new URL(url).hostname;
  if (host === 'my.vatsim.net') await openVatsim(url);
  else if (['dispatch.simbrief.com','www.simbrief.com'].includes(host)) await browser.openInteractive('simbrief', url);
  else await shell.openExternal(url);
});
handle('login', async name => {
  if (!['simbrief','vatsim'].includes(name)) throw new Error('Unknown service.');
  if (active) throw new Error('Finish the current dispatch before opening account settings.');
  if (name === 'vatsim') await openVatsim(LOGIN_URLS.vatsim);
  else await browser.openInteractive(name, LOGIN_URLS[name]);
});
async function openVatsim(url) {
  if (vatsim.connected()) await vatsim.request('open', { url, visible: true });
  else await shell.openExternal(url);
}
handle('companion-status', () => vatsim.status());
handle('companion-setup', async () => {
  if (active) throw new Error('Finish or cancel the current dispatch first.');
  vatsim.prepare();
  clipboard.writeText(vatsim.folder);
  const error = await shell.openPath(vatsim.folder);
  if (error) throw new Error(error);
  return vatsim.status();
});
if (process.env.VITE_DEV_SERVER_URL && !app.isPackaged) await main.loadURL(process.env.VITE_DEV_SERVER_URL);
else await main.loadFile(path.join(root, 'dist/index.html'));
app.on('window-all-closed', () => app.quit());
main.on('closed', () => { if (active) active.cancelled = true; });
let quitting = false;
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); quitting = true; if (active) active.cancelled = true; telemetry.stop(false); void Promise.allSettled([browser.close(), vatsim.close()]).finally(() => app.quit()); } });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (main && !main.isDestroyed()) { if (main.isMinimized()) main.restore(); main.show(); main.focus(); } });
  void start().catch(error => { console.error('Flight Dispatch startup failed:', error.message); app.exit(1); });
}
