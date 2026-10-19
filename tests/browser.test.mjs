import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessions, interactiveBrowserArgs, LOGIN_URLS } from '../electron/browser.mjs';

test('interactive sign-in uses the dedicated profile without automation or debugging arguments', () => {
  const args = interactiveBrowserArgs('C:\\Flight Dispatch\\browser-profile\\msedge', LOGIN_URLS.vatsim);
  assert.equal(args[0], '--user-data-dir=C:\\Flight Dispatch\\browser-profile\\msedge');
  assert.equal(args.at(-1), 'https://my.vatsim.net');
  assert.ok(args.includes('--disable-background-mode')); // Closing windows releases the profile.
  assert.ok(args.every(arg => !/headless|debugging|automation|disable-blink|user-agent|no-sandbox/.test(arg)));
});

test('normal browser opens only after the automation context releases the profile', async () => {
  const sessions = new BrowserSessions('unused');
  const events = [];
  sessions.context = { close: async () => events.push('automation closed') };
  sessions.createInteractive = async url => { events.push(url); return { closed: false }; };
  await sessions.openInteractive('vatsim', LOGIN_URLS.vatsim);
  assert.deepEqual(events, ['automation closed', LOGIN_URLS.vatsim]);
  assert.equal(sessions.context, null);
  await assert.rejects(sessions.openInteractive('vatsim', 'https://example.com'), /Unapproved/);
});

test('background dispatch prompts and waits until normal-browser sign-in has closed', async () => {
  const sessions = new BrowserSessions('unused');
  const events = [];
  sessions.interactive = { closed: false };
  sessions.createContext = async () => { events.push('background'); return { on() {} }; };
  const pending = sessions.ensure({ onWaiting: message => events.push(message) });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(events.length, 1);
  assert.match(events[0], /close all Flight Dispatch browser windows/);
  sessions.interactive.closed = true;
  await pending;
  assert.equal(events.at(-1), 'background');
  assert.equal(sessions.interactive, null);
});

test('cancel and timeout stop waiting without killing the user sign-in window', async () => {
  const sessions = new BrowserSessions('unused');
  const session = { closed: false };
  sessions.interactive = session;
  sessions.createContext = () => assert.fail('Must not start automation');
  await assert.rejects(sessions.ensure({ isCancelled: () => true }), /cancelled/);
  assert.equal(session.closed, false);
  await assert.rejects(sessions.waitForInteractive({ timeout: 0 }), /Still waiting/);
  assert.equal(session.closed, false);
});

test('authentication recovery names the service, returns to the requested flight, and never loops', async () => {
  const sessions = new BrowserSessions('unused');
  const events = [];
  sessions.createInteractive = async url => { events.push(url); return { closed: true }; };
  const page = {};
  sessions.createContext = async () => ({ on() {}, newPage: async () => page });
  const tab = { name: 'vatsim', target: 'https://my.vatsim.net/pilots/flightplan?raw=test', navigate: async url => events.push(url) };
  await sessions.authenticate(tab, { onWaiting: message => events.push(message) });
  assert.match(events[0], /Sign in to VATSIM/);
  assert.deepEqual(events.slice(1), [LOGIN_URLS.vatsim, tab.target]);
  assert.equal(tab.page, page);
  assert.equal(sessions.tabs.get('vatsim'), tab);
  await assert.rejects(sessions.authenticate(tab), /still requires sign-in or security verification/);
  assert.equal(events.length, 3);
});

test('additional sign-in windows keep tracking the original profile process', async () => {
  const sessions = new BrowserSessions('unused');
  const original = { closed: false }, forwarded = { closed: true };
  let count = 0;
  sessions.createInteractive = async () => ++count === 1 ? original : forwarded;
  await sessions.openInteractive('vatsim', LOGIN_URLS.vatsim);
  await sessions.openInteractive('simbrief', LOGIN_URLS.simbrief);
  assert.equal(sessions.interactive, original);
});
