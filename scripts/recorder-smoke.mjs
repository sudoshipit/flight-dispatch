import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOFP, DEFAULT_SETTINGS } from '../shared/domain.mjs';
import { ofp } from '../tests/fixtures.mjs';
import { distanceNm } from '../shared/landing.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-recovery-'));
fs.mkdirSync(path.join(directory, 'data'));
fs.mkdirSync('artifacts', { recursive: true });
fs.copyFileSync('data/aircraft.json', path.join(directory, 'data/aircraft.json'));
fs.writeFileSync(path.join(directory, 'data/settings.json'), JSON.stringify(DEFAULT_SETTINGS));
const base = Date.now() - 60000, utc = ms => new Date(base + ms).toISOString();
const plan = { ...parseOFP(ofp), actual: { out: utc(-3600000), off: utc(-3000000), on: utc(0), in: null, phase: 'taxi-in', lastObservedAt: utc(0) },
  landing: { startedAt: utc(-3600000), completedAt: null, simulator: 'Recovery fixture', contacts: [{
    at: base, time: utc(0), rateFpm: -162, method: 'sampled-estimate', bounce: false, groundspeed: 120,
    pitch: 3, bank: 1, lat: 42.94, lon: -78.73, sampleAgeMs: 50, destinationDistanceNm: distanceNm({ lat: 42.94, lon: -78.73 }, parseOFP(ofp).destination),
  }] } };
const historyPath = path.join(directory, 'data/history.json');
fs.writeFileSync(historyPath, JSON.stringify([plan]));
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.FLIGHT_DISPATCH_EXECUTABLE,
    args: process.env.FLIGHT_DISPATCH_EXECUTABLE ? [] : ['.'], timeout: 45000,
    env: { ...process.env, FLIGHT_DISPATCH_TEST_DATA: directory } });
  await app.evaluate(({ app, BrowserWindow }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const { Telemetry } = require('./electron/telemetry.mjs'), start = Telemetry.prototype.start;
    Telemetry.prototype.start = function(...args) {
      this.adapters = { simconnect: () => ({ close() {} }), xplane: sample => { globalThis.__sample = sample; return { close() {} }; } };
      globalThis.__tracker = this;
      return start.apply(this, args);
    };
    require('./electron/services.mjs').Services.prototype.enrich = async () => ({ weather: {}, airports: {}, gates: {} });
    BrowserWindow.getAllWindows().forEach(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Recent flights 1' }).click();
  await page.getByLabel('Filter recent flights').selectOption('in-progress');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-row').click();
  await expect(page.getByRole('button', { name: 'Finish tracking' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Your landing rate' })).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async text => { window.__report = text; } } }));
  return page;
}
const feed = async (start, end, extra = {}) => app.evaluate((_, { base, start, end, extra }) => {
  globalThis.__tracker.lastEmit = 0;
  for (let ms = start; ms <= end; ms += 100) globalThis.__sample({ at: base + ms, simTime: ms / 1000,
    onGround: true, agl: 0, verticalSpeed: 0, groundspeed: 12, parkingBrake: false,
    lat: 42.94, lon: -78.73, simulator: 'Recovery fixture', ...extra });
}, { base, start, end, extra });

try {
  let page = await launch();
  await feed(100, 2000);
  await page.locator('.telemetry-details summary').click();
  const readout = page.getByRole('region', { name: 'Simulator telemetry' });
  await expect(readout).toContainText('12 kt');
  await expect(readout).toContainText('Released');
  await expect(readout).toContainText('On ground');
  await readout.screenshot({ path: 'artifacts/telemetry-readout.png' });
  await app.close(); app = null;
  const checkpoint = JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0];
  expect(checkpoint.actual.lastObservedAt).toBe(utc(2000));
  expect(checkpoint.landing.completedAt).toBeNull();
  expect(checkpoint.actual.in).toBeNull();

  page = await launch();
  await feed(3000, 3000, { paused: true });
  await feed(4000, 9000, { groundspeed: 0, parkingBrake: true });
  await expect(page.getByRole('region', { name: 'Live flight timings' })).toContainText('Flight complete');
  await expect(page.getByRole('dialog', { name: 'Your landing rate' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Landing summary' })).toContainText('-162');
  await page.getByRole('button', { name: 'Copy flight report', exact: true }).click();
  const report = await page.evaluate(() => window.__report);
  expect(report).toContain('-162 ft/min · sampled estimate');
  expect(report).toContain('On block: ' + utc(4000).replace('T', ' ').replace('.000Z', 'Z'));
  expect(report).toContain('Taxi-in: 00:00:04');
  const saved = JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0];
  expect(saved.actual.in).toBe(utc(4000));
  expect(saved.actual.on).toBe(plan.actual.on);
  expect(saved.landing.contacts).toEqual(plan.landing.contacts);
  expect(saved.landing.startedAt).toBe(plan.landing.startedAt);
  await page.getByRole('region', { name: 'Live flight timings' }).screenshot({ path: 'artifacts/recovered-flight-timings.png' });
  expect(errors).toEqual([]);
  console.log('Recorder recovery passed: app-close checkpoint, unfinished taxi-in resume, no repeated touchdown popup, on-block completion, telemetry readout and copied flight report.');
} finally { if (app) await app.close(); }
