import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const LOGIN_URLS = { simbrief: 'https://dispatch.simbrief.com', vatsim: 'https://my.vatsim.net' };
export const SIGN_IN_MESSAGE = 'Finish signing in, then close all Flight Dispatch browser windows. Your session is saved and dispatch resumes automatically.';
// Sign-in must be a normal browser process: no Playwright, debugging connection,
// injected scripts, or automation switches while the user completes verification.
export function interactiveBrowserArgs(directory, url) {
  return [`--user-data-dir=${directory}`, '--new-window', '--no-first-run', '--disable-background-mode', url];
}

export function serviceAllowed(value, name) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (name === 'simbrief' ? ['simbrief.com', 'navigraph.com'].some(d => u.hostname === d || u.hostname.endsWith('.' + d)) : ['my.vatsim.net', 'auth.vatsim.net', 'connect.vatsim.net'].includes(u.hostname)); } catch { return false; }
}
export const EXTENSION_URLS = {
  protonpass: 'https://proton.me/pass/download/edge',
  onepassword: 'https://1password.com/downloads/browser-extension/',
};
// Keep extensions, native password-manager integration and browser security enabled.
// Playwright's usual test defaults disable several of these features.
export const IGNORED_BROWSER_ARGS = ['--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-component-update', '--disable-background-networking', '--disable-client-side-phishing-detection', '--password-store=basic', '--use-mock-keychain', '--disable-ipc-flooding-protection', '--unsafely-disable-devtools-self-xss-warnings'];

export class BrowserSessions {
  constructor(directory, preference = () => 'auto') {
    this.directory = directory;
    this.preference = preference;
    this.tabs = new Map();
    this.context = null;
    this.launching = null;
    this.interactive = null;
    this.interactiveLaunching = null;
  }
  installation() {
    const candidates = { msedge: ['Microsoft/Edge/Application/msedge.exe'], chrome: ['Google/Chrome/Application/chrome.exe'] };
    const requested = this.preference();
    for (const channel of requested === 'auto' ? ['msedge', 'chrome'] : [requested]) {
      for (const base of [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean)) {
        const executable = candidates[channel]?.map(relative => path.join(base, relative)).find(file => fs.existsSync(file));
        if (executable) return { channel, executable };
      }
    }
    throw new Error('Install Microsoft Edge or Google Chrome, then choose it in Settings → Sign-in browser.');
  }
  channel() { return this.installation().channel; }
  async createContext() {
    const channel = this.channel();
    return chromium.launchPersistentContext(path.join(this.directory, channel), {
      channel, headless: true, viewport: null, chromiumSandbox: true,
      ignoreDefaultArgs: IGNORED_BROWSER_ARGS,
      args: ['--window-size=1160,850'], timeout: 45000,
    });
  }
  async ensure(options = {}) {
    await this.waitForInteractive(options);
    if (options.isCancelled?.()) throw new Error('Dispatch cancelled.');
    if (this.launching) await this.launching;
    if (this.context) return this.context;
    this.launching = (async () => {
      await this.close();
      try {
        const context = await this.createContext();
        this.context = context;
        context.on('close', () => { if (this.context === context) this.context = null; });
        return context;
      } catch { throw new Error('Could not start the Flight Dispatch browser profile. Close all windows in its dedicated profile, then retry. Your everyday browser can stay open.'); }
    })();
    try { return await this.launching; } finally { this.launching = null; }
  }
  async open(name, url, options = {}) {
    if (!serviceAllowed(url, name)) throw new Error('Unapproved service URL.');
    const context = await this.ensure(options);
    let tab = this.tabs.get(name);
    if (!tab || tab.isDestroyed()) {
      tab = new ServiceTab(this, name, await context.newPage());
      this.tabs.set(name, tab);
    }
    tab.target = url;
    await tab.navigate(url);
    return tab;
  }
  async authenticate(tab, options = {}) {
    const service = tab.name === 'vatsim' ? 'VATSIM' : 'SimBrief';
    if (tab.signInAttempts) throw new Error(`${service} still requires sign-in or security verification after browser sign-in. Automatic dispatch stopped before submission. Check your session using Sign in in Settings. The app cannot complete security challenges in the background.`);
    tab.signInAttempts = 1;
    const waiting = { ...options, onWaiting: () => options.onWaiting?.(`Sign in to ${service} in the browser. ${SIGN_IN_MESSAGE}`) };
    waiting.onWaiting();
    await this.openInteractive(tab.name, LOGIN_URLS[tab.name]);
    const context = await this.ensure(waiting);
    // Reuse the saved browser profile, never copy or inspect authentication cookies.
    tab.page = await context.newPage();
    this.tabs.set(tab.name, tab);
    await tab.navigate(tab.target);
  }
  async createInteractive(url) {
    const { channel, executable } = this.installation();
    const directory = path.join(this.directory, channel);
    fs.mkdirSync(directory, { recursive: true });
    const child = spawn(executable, interactiveBrowserArgs(directory, url), { stdio: 'ignore', windowsHide: false });
    const session = { closed: false, error: null };
    child.once('exit', code => { session.closed = true; if (code) session.error = new Error('The sign-in browser exited unexpectedly. Open Sign in from Settings to try again.'); });
    child.once('error', () => { session.closed = true; session.error = new Error('Could not open the sign-in browser. Check the selected browser in Settings.'); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(session.error)); });
    child.unref();
    return session;
  }
  async startInteractive(url) {
    const previous = this.interactiveLaunching;
    const launching = (async () => {
      if (previous) await previous;
      await this.close();
      const session = await this.createInteractive(url);
      // Additional service/extension windows are forwarded to the existing browser
      // process; keep tracking that original process until all its windows close.
      if (!this.interactive || this.interactive.closed) this.interactive = session;
    })();
    this.interactiveLaunching = launching;
    try { await launching; } finally { if (this.interactiveLaunching === launching) this.interactiveLaunching = null; }
  }
  async openInteractive(name, url) {
    if (!serviceAllowed(url, name)) throw new Error('Unapproved service URL.');
    await this.startInteractive(url);
  }
  async waitForInteractive({ onWaiting, isCancelled, timeout = 10 * 60000 } = {}) {
    if (this.interactiveLaunching) await this.interactiveLaunching;
    const session = this.interactive;
    if (!session) return;
    if (!session.closed) onWaiting?.(SIGN_IN_MESSAGE);
    const started = Date.now();
    while (!session.closed) {
      if (isCancelled?.()) throw new Error('Dispatch cancelled. You can finish signing in and close the browser when ready.');
      if (Date.now() - started >= timeout) throw new Error('Still waiting for the sign-in browser to close. Finish signing in, close all Flight Dispatch browser windows, then retry.');
      await sleep(250);
    }
    if (this.interactive === session) this.interactive = null;
    if (session.error) throw session.error;
  }
  async setup(extension) {
    let url = extension ? EXTENSION_URLS[extension] : (this.channel() === 'msedge' ? 'edge://extensions/' : 'chrome://extensions/');
    if (extension === 'protonpass' && this.channel() === 'chrome') url = 'https://proton.me/pass/download/chrome';
    if (!url) throw new Error('Unknown password manager.');
    await this.startInteractive(url);
  }
  async close() {
    const context = this.context;
    this.context = null;
    if (context) await context.close().catch(() => {});
  }
}

class ServiceTab {
  constructor(owner, name, page) { this.owner = owner; this.name = name; this.page = page; this.target = ''; this.lastResume = 0; this.resumes = 0; }
  isDestroyed() { return this.page.isClosed(); }
  async close() { if (!this.isDestroyed()) await this.page.close().catch(() => {}); }
  async navigate(url) {
    try { await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch (error) { if (!this.page.url().startsWith('https://')) throw new Error(`Could not load ${this.name}. Check your internet connection.`); }
  }
  async needsLogin() {
    const url = new URL(this.page.url());
    if (!serviceAllowed(url.href, this.name)) return false;
    if (/login|sign[-_]?in|authorize|authentication|challenge/i.test(url.pathname) || ['auth.vatsim.net', 'connect.vatsim.net'].includes(url.hostname) || url.hostname.endsWith('navigraph.com')) return true;
    return this.page.evaluate(() => {
      const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      if ([...document.querySelectorAll('input[type="password"], iframe[src*="challenges.cloudflare.com"], #challenge-form')].some(visible) || /just a moment|verify you are human|attention required.*cloudflare/i.test(document.title)) return true;
      // SimBrief can render its login overlay at /options/custom without a URL
      // redirect or password input. Detect the visible Sign In control as well.
      return [...document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]')].some(el => visible(el) && /^(?:sign\s*in|log\s*in)(?:\s+(?:to|with)\s+(?:vatsim|simbrief|navigraph))?$/i.test((el.innerText || el.value || el.textContent || '').replace(/\s+/g, ' ').trim()));
    }).catch(() => false);
  }
  async resumeAfterLogin() {
    const url = new URL(this.page.url());
    const home = this.name === 'vatsim' ? url.hostname === 'my.vatsim.net' && /^\/(?:dashboard|home)?\/?$/.test(url.pathname) : url.hostname === 'dispatch.simbrief.com' && /^\/(?:home|dashboard)?\/?$/.test(url.pathname);
    if (home && this.resumes < 2 && Date.now() - this.lastResume > 15000) {
      this.resumes++; this.lastResume = Date.now(); await this.navigate(this.target);
    }
  }
  async step(fn, args) {
    if (this.isDestroyed() || !serviceAllowed(this.page.url(), this.name)) return null;
    try { return await this.page.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`); } catch { return null; }
  }
  async readAirframes(base) {
    if (!this.page.url().startsWith('https://dispatch.simbrief.com/options')) return null;
    const options = await this.page.evaluate(base => {
      if (document.querySelector('#basetype')?.value !== base) return null;
      const select = document.querySelector('select[name="type"]');
      if (!select?.options.length) return null;
      return [...select.options].filter(o => !o.disabled && /^\d+_\d+$/.test(o.value) && o.dataset.type === 'user').map(o => ({ id: o.value, name: o.textContent.trim(), icao: o.dataset.icao || base, registration: o.dataset.registration || '', source: 'Personal airframe' }));
    }, base);
    if (!options) return null;
    const result = [];
    for (const option of options) {
      await this.page.locator('select[name="type"]').selectOption(option.id);
      // SimBrief updates passenger limits through the normal selection handler.
      await this.page.waitForFunction(id => document.querySelector('select[name="type"]')?.value === id && document.querySelector('[name="pax"]')?.hasAttribute('max'), option.id, { timeout: 10000 });
      const maxPassengers = await this.page.locator('[name="pax"]').getAttribute('max');
      result.push({ ...option, maxPassengers: /^\d+$/.test(maxPassengers ?? '') ? Number(maxPassengers) : null });
    }
    return result;
  }
}
