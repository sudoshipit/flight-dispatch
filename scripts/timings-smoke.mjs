import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOFP, DEFAULT_SETTINGS } from '../shared/domain.mjs';
import { ofp } from '../tests/fixtures.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-local-timings-'));
fs.mkdirSync(path.join(directory, 'data'));
fs.mkdirSync('artifacts', { recursive: true });
fs.copyFileSync('data/aircraft.json', path.join(directory, 'data/aircraft.json'));
fs.writeFileSync(path.join(directory, 'data/settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, simbriefId: 'fixture' }));
const original = parseOFP(ofp), historyPath = path.join(directory, 'data/history.json');
fs.writeFileSync(historyPath, JSON.stringify([original]));
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: process.env.FLIGHT_DISPATCH_EXECUTABLE,
    args: process.env.FLIGHT_DISPATCH_EXECUTABLE ? [] : ['.'], timeout: 45000,
    env: { ...process.env, FLIGHT_DISPATCH_TEST_DATA: directory } });
  await app.evaluate(({ app, BrowserWindow }, original) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const { Telemetry } = require('./electron/telemetry.mjs'), start = Telemetry.prototype.start;
    Telemetry.prototype.start = function(...args) {
      this.adapters = { simconnect: () => ({ close() {} }), xplane: sample => { globalThis.__sample = sample; return { close() {} }; } };
      globalThis.__tracker = this;
      return start.apply(this, args);
    };
    const { Services } = require('./electron/services.mjs');
    Services.prototype.enrich = async () => ({ weather: {}, airports: {}, gates: {} });
    Services.prototype.ofp = async () => original;
    BrowserWindow.getAllWindows().forEach(win => { win.webContents.setBackgroundThrottling(false); win.showInactive(); });
  }, original);
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-12-31T23:50:00Z'));
  await page.getByRole('button', { name: 'Recent flights 1' }).click();
  await page.locator('.history-row').click();
  await expect(page.getByRole('region', { name: 'Live flight timings' })).toBeVisible();
  return page;
}
try {
  let page = await launch();
  await page.getByRole('button', { name: 'Edit timings', exact: true }).click();
  let editor = page.getByRole('form', { name: 'Edit planned timings' });
  await editor.getByLabel('Planned departure date').fill('2026-12-31');
  await editor.getByLabel('Planned off-block time').fill('23:55:00');
  await editor.getByLabel('Planned taxi-out minutes').fill('10');
  await editor.getByLabel('Planned air time minutes').fill('120');
  await editor.getByLabel('Planned taxi-in minutes').fill('5');
  await expect(editor.getByLabel('Timing preview')).toContainText('01 Jan, 02:10Z');
  await editor.screenshot({ path: 'artifacts/edit-timings.png' });
  await editor.getByRole('button', { name: 'Save timings' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Off-block countdown' })).toContainText('00:05:00');
  await expect(page.getByLabel('Planned timings')).toContainText('Locally adjusted timeline');
  await expect(page.locator('.briefing-heading')).toContainText('23:55Z departure · Local timings');
  const saved = JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0];
  expect(saved.timingOverride).toEqual({ offBlock: '2026-12-31T23:55:00.000Z', taxiOutSeconds: 600, airborneSeconds: 7200, taxiInSeconds: 300 });
  expect(saved.ofp).toEqual(original.ofp);
  expect(saved.filing).toEqual(original.filing);
  await page.getByRole('button', { name: 'Edit timings', exact: true }).click();
  await editor.getByLabel('Planned taxi-out minutes').fill('99');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0].timingOverride.taxiOutSeconds).toBe(600);
  // A simulator checkpoint must preserve both edits and observations.
  await app.evaluate(() => {
    globalThis.__tracker.lastSaveAttempt = 0;
    globalThis.__sample({ at: Date.parse('2026-12-31T23:50:00Z'), simTime: 1, onGround: true,
      agl: 0, verticalSpeed: 0, groundspeed: 0, parkingBrake: true, lat: 27.98, lon: -82.53, simulator: 'Timing fixture' });
  });
  await expect(page.locator('.timing-edit-action')).toContainText('Local timings');
  await app.close(); app = null;

  page = await launch();
  await expect(page.getByRole('region', { name: 'Off-block countdown' })).toContainText('00:05:00');
  const imported = await page.evaluate(() => window.dispatch.importLatest());
  expect(imported.plan.timingOverride).toEqual(saved.timingOverride);
  expect(imported.plan.actual.lastObservedAt).toBe('2026-12-31T23:50:00.000Z');
  await page.getByRole('button', { name: 'Edit timings', exact: true }).click();
  editor = page.getByRole('form', { name: 'Edit planned timings' });
  await expect(editor.getByLabel('Planned off-block time')).toHaveValue('23:55:00');
  await expect(editor.getByLabel('Planned taxi-out minutes')).toHaveValue('10');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 720));
  await editor.screenshot({ path: 'artifacts/edit-timings-compact.png' });
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Main-process validation protects the IPC boundary even without form validation.
  const invalid = await page.evaluate(async id => { try { await window.dispatch.saveTimings(id, { offBlock: '2026-02-30T12:00:00.000Z', taxiOutSeconds: 1, airborneSeconds: 1, taxiInSeconds: 1 }); return ''; } catch (e) { return e.message; } }, original.id);
  expect(invalid).toContain('valid departure date');
  await editor.getByRole('button', { name: 'Reset to SimBrief' }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.timing-edit-action')).not.toContainText('Local timings');
  await expect(page.getByLabel('Planned timings')).toContainText('Estimated timeline');
  const reset = JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0];
  expect(reset.timingOverride).toBeNull();
  expect(reset.ofp).toEqual(original.ofp);
  expect(reset.actual).toEqual(imported.plan.actual);
  expect(errors).toEqual([]);
  console.log('Timing editor passed: UTC rollover, live countdown, preview, cancel, local persistence, app restart, reimport, recorder checkpoint, IPC validation, reset and compact layout.');
} finally { if (app) await app.close(); }
