import { CONFIG } from './config.mjs';
import { vatsimPageStep } from './automation.mjs';
import { vatsimPageState } from './page-state.mjs';

const allowed = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ['my.vatsim.net','auth.vatsim.net','connect.vatsim.net'].includes(u.hostname); } catch { return false; }
};
let socket, connecting = false;
const tasks = new Map();
async function owned(id) {
  const record = (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`];
  if (!record) throw new Error('This tab was not opened by Flight Dispatch.');
  const tab = await chrome.tabs.get(id);
  const url = allowed(tab.url) ? tab.url : tab.status === 'loading' && allowed(tab.pendingUrl) ? tab.pendingUrl : null;
  if (!url) throw new Error('The VATSIM tab moved to an unsupported page.');
  tab.effectiveUrl = url;
  return { record, tab };
}
async function execute(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  return results[0]?.result ?? null;
}
async function command(action, args) {
  if (action === 'open') {
    if (!allowed(args.url) || new URL(args.url).hostname !== 'my.vatsim.net') throw new Error('Unapproved VATSIM URL.');
    const previous = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    let tab, createdWindow = false;
    if (previous) tab = await chrome.tabs.create({ url: args.url, active: args.visible === true, windowId: previous.windowId });
    else { const win = await chrome.windows.create({ url: args.url, focused: args.visible === true, state: args.visible ? 'normal' : 'minimized' }); tab = win.tabs[0]; createdWindow = true; }
    await chrome.storage.session.set({ [`tab:${tab.id}`]: { target: args.url, previous: previous?.id, createdWindow, resumes: 0 } });
    if (args.visible) await chrome.windows.update(tab.windowId, { state: 'normal', focused: true });
    return { tabId: tab.id };
  }
  if (!Number.isInteger(args.tabId)) throw new Error('Invalid browser tab.');
  const { record, tab } = await owned(args.tabId);
  if (action === 'state') {
    if (tab.status === 'loading') return { state: 'loading' };
    const state = await execute(tab.id, vatsimPageState);
    if (state?.state === 'home' && record.resumes < 2) {
      await chrome.storage.session.set({ [`tab:${tab.id}`]: { ...record, resumes: record.resumes + 1 } });
      await chrome.tabs.update(tab.id, { url: record.target });
      return { state: 'loading' };
    }
    return state;
  }
  if (action === 'show') {
    await chrome.windows.update(tab.windowId, { state: 'normal', focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    return true;
  }
  if (action === 'background') {
    if (record.previous) await chrome.tabs.update(record.previous, { active: true }).catch(() => {});
    if (record.createdWindow) await chrome.windows.update(tab.windowId, { state: 'minimized' });
    return true;
  }
  if (action === 'step') {
    if (new URL(tab.url).hostname !== 'my.vatsim.net' || !new URL(tab.url).pathname.startsWith('/pilots/flightplan')) throw new Error('The VATSIM filing form is not ready.');
    return execute(tab.id, vatsimPageStep, [args.fields, args.allowSubmit === true, args.submitted === true, args.baseline || '']);
  }
  if (action === 'close') { await chrome.tabs.remove(tab.id); await chrome.storage.session.remove(`tab:${tab.id}`); return true; }
  throw new Error('Unsupported companion action.');
}
async function connectionState(connected, message) {
  await chrome.storage.local.set({ connected, message });
  await chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#618b41' });
}
function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN) return;
  connecting = true;
  const ws = new WebSocket(CONFIG.url); socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: CONFIG.token, version: CONFIG.version }));
  ws.onmessage = async event => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') { connecting = false; await connectionState(true, 'Connected to Flight Dispatch. Keep this browser open; it can be minimized.'); return; }
    if (message.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
    if (message.type !== 'command' || typeof message.id !== 'string' || Date.now() > message.deadline) return;
    // Commands are never retried following a lost connection. Submission intent
    // is already saved by the desktop app before it sends a filing command.
    if (tasks.has(message.id)) return;
    const task = (async () => {
      try { const result = await command(message.action, message.args); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, result })); }
      catch (error) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, error: error.message })); }
    })();
    tasks.set(message.id, task);
    void task.finally(() => { if (tasks.size > 200) tasks.delete(tasks.keys().next().value); });
  };
  ws.onerror = () => {};
  ws.onclose = event => {
    if (socket !== ws) return;
    socket = null; connecting = false;
    void connectionState(false, event.code === 1008 ? event.reason : 'Open Flight Dispatch to connect.');
    if (event.code !== 1008) setTimeout(connect, 5000);
  };
}
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create('connect', { periodInMinutes: 0.5 }); connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'connect') connect(); });
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'reconnect') connect(); });
chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove(`tab:${id}`); });
connect();
