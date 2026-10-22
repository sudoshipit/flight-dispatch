import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseOFP, DEFAULT_SETTINGS, vatsimFields } from '../shared/domain.mjs';
import { ofp } from '../tests/fixtures.mjs';
import { filingPage } from '../tests/filing-page.mjs';
import { launchTestCompanion } from './companion-test-client.mjs';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-smoke-'));
fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
fs.copyFileSync('data/aircraft.json', path.join(userData, 'data/aircraft.json'));
fs.writeFileSync(path.join(userData,'data/settings.json'), JSON.stringify(DEFAULT_SETTINGS));
fs.writeFileSync(path.join(userData,'data/history.json'), JSON.stringify([parseOFP(ofp)]));
fs.mkdirSync('artifacts', { recursive: true });
const app = await electron.launch({ executablePath: process.env.FLIGHT_DISPATCH_EXECUTABLE, args: process.env.FLIGHT_DISPATCH_EXECUTABLE ? [] : ['.'], timeout: 45000, env: { ...process.env, FLIGHT_DISPATCH_TEST_DATA:userData } });
let companion;
try {
  const page = await app.firstWindow();
  // Windows can stop painting hidden windows after full-page screenshot resizing.
  // Show the isolated test window without taking focus so captures keep rendering.
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().forEach(win=>{
    win.webContents.setBackgroundThrottling(false);
    win.showInactive();
  }));
  await app.evaluate(({app}, fixture) => {
    const localRequire = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    localRequire('./electron/services.mjs').Services.prototype.ofp = async () => fixture;
    // Install fixtures before automatic tracking can start when a briefing opens.
    const { Telemetry } = localRequire('./electron/telemetry.mjs');
    const start = Telemetry.prototype.start;
    Telemetry.prototype.start = function(...args) {
      this.adapters = {
        simconnect: () => ({ close() {} }),
        xplane: sample => { globalThis.__sample = sample; return { close() {} }; },
      };
      return start.apply(this, args);
    };
  }, parseOFP(ofp));
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await expect(page.getByRole('heading',{name:"Let's get you airborne."})).toBeVisible();
  // Exercise UTC midnight/year rollover even when Windows is using a local time zone.
  await page.clock.setFixedTime('2026-12-31T23:45:37Z');
  await page.reload();
  await expect(page.getByRole('heading',{name:"Let's get you airborne."})).toBeVisible();
  await expect(page.getByLabel('Aircraft type')).toBeEnabled({timeout:45000});
  const expectNewFlight = async (time = '01:35') => {
    for (const label of ['Callsign','Flight number','Aircraft type','Variant or airframe','Departure','Destination','Custom route','Taxi out minutes','Taxi in minutes','Extra fuel minutes','Final reserve','Cruise altitude feet','Alternate airport']) await expect(page.getByLabel(label,{exact:true})).toHaveValue('');
    await expect(page.getByLabel('Departure date')).toHaveValue('2027-01-01');
    await expect(page.getByLabel('Off block time')).toHaveValue(time);
    await expect(page.getByRole('button',{name:'Auto Let SimBrief decide'})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByLabel('Variant or airframe')).toBeDisabled();
    await expect(page.locator('.route-map')).toHaveCount(0);
  };
  await expectNewFlight('00:15');
  await page.screenshot({path:'artifacts/new-flight-empty.png',fullPage:true});
  await page.getByLabel('Callsign',{exact:true}).fill('SWA');
  await page.getByLabel('Aircraft type').selectOption('B737');
  await expect(page.locator('.ci-pill')).toHaveText('40');
  await page.getByLabel('Variant or airframe').selectOption('746599_1776105415884');
  await expect(page.getByRole('button',{name:'Full flight'})).toContainText('124 passengers');
  await page.getByRole('button',{name:'Set as default for B737'}).click();
  await expect(page.getByRole('button',{name:'Saved default for B737'})).toBeEnabled();
  await page.getByLabel('Callsign',{exact:true}).fill('DAL');
  await page.getByLabel('Aircraft type').selectOption('A320');
  await expect(page.locator('.ci-pill')).toHaveText('25');
  await page.getByLabel('Aircraft type').selectOption('B738');
  await expect(page.locator('.ci-pill')).toHaveText('35');
  await page.getByRole('button',{name:'Full flight'}).click();
  await expect(page.getByRole('button',{name:'Full flight'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Custom Set your own count'}).click();
  await page.getByLabel('Passenger count').fill('0');
  await page.getByRole('button',{name:'Auto Let SimBrief decide'}).click();
  await page.getByLabel('Callsign',{exact:true}).fill('SWA');
  await page.getByLabel('Aircraft type').selectOption('B737');
  await expect(page.getByLabel('Variant or airframe')).toHaveValue('746599_1776105415884');
  await page.getByLabel('Custom route', {exact:true}).fill('DCT CAMJO Q99 HEPAR');
  for (const [label,value] of [['Flight number','123'],['Departure','KTPA'],['Destination','KBUF'],['Departure date','2026-10-19'],['Off block time','14:15'],['Taxi out minutes','25'],['Taxi in minutes','6'],['Extra fuel minutes','10'],['Cruise altitude feet','35000'],['Alternate airport','KROC']]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Final reserve').selectOption('45');
  await page.getByRole('button',{name:'Custom Set your own count'}).click();
  await page.getByLabel('Passenger count').fill('100');
  await page.clock.setFixedTime('2027-01-01T01:05:42Z');
  await expect(page.getByLabel('Departure date')).toHaveValue('2026-10-19');
  await expect(page.getByLabel('Off block time')).toHaveValue('14:15');
  await expect(page.locator('.route-map')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'artifacts/dispatch.png',fullPage:true});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByLabel('SimBrief Pilot ID or username')).toHaveValue('');
  await page.getByLabel('SimBrief Pilot ID or username').fill('test-pilot');
  await page.getByLabel('Rule 1 cost index').fill('42');
  await page.getByRole('button',{name:'Save preferences'}).click();
  await expect(page.getByRole('status').filter({hasText:'Preferences saved.'})).toBeVisible();
  await page.getByRole('button',{name:'New flight',exact:true}).click();
  await expectNewFlight();
  await page.getByLabel('Callsign',{exact:true}).fill('SWA');
  await page.getByLabel('Aircraft type').selectOption('B737');
  await expect(page.getByLabel('Variant or airframe')).toHaveValue('746599_1776105415884');
  await expect(page.locator('.ci-pill')).toHaveText('42');
  await page.getByRole('button',{name:'New flight',exact:true}).click();
  await expectNewFlight();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Restore default rules'}).click();
  await page.getByRole('button',{name:'Save preferences'}).click();
  await page.screenshot({path:'artifacts/settings.png',fullPage:true});
  await page.getByRole('button',{name:'Recent flights 1'}).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.getByLabel('Search recent flights').fill('SWA Tampa');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.getByLabel('Search recent flights').fill('no-match');
  await expect(page.getByRole('heading',{name:'No matching flights'})).toBeVisible();
  await page.getByRole('button',{name:'Show all flights',exact:true}).click();
  await page.getByLabel('Filter recent flights').selectOption('attention');
  await expect(page.locator('.history-row')).toHaveCount(0);
  await page.getByRole('button',{name:'Show all flights',exact:true}).click();
  await page.screenshot({path:'artifacts/history-search.png'});
  await page.locator('.history-row').click();
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:60000});
  await expect(page.locator('.callsign-link')).toHaveText('SWA123');
  // Keep the user's actual Windows clipboard untouched during UI checks.
  await page.evaluate(() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedBriefing=text;}}}));
  await page.getByRole('button',{name:'Copy briefing',exact:true}).click();
  expect(await page.evaluate(()=>window.__copiedBriefing)).toContain('Planned fuel (LBS)');
  await page.locator('.briefing-actions').getByRole('button',{name:'Copy route',exact:true}).click();
  expect(await page.evaluate(()=>window.__copiedBriefing)).toBe(parseOFP(ofp).route);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Return to tracked flight SWA123',exact:true}).click();
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:60000});
  await expect(page.locator('.callsign-link')).toHaveText('SWA123');
  await expect(page.locator('.stat').first()).toContainText('FL370');
  await expect(page.locator('.route-map')).toHaveCount(1);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.getByRole('button',{name:'Fit route',exact:true}).click();
  await expect(page.getByLabel('Map zoom')).toHaveText('100%');
  const tocOption = await page.getByLabel('Inspect waypoint').locator('option').filter({hasText:'TOC'}).getAttribute('value');
  await page.getByLabel('Inspect waypoint').selectOption(tocOption);
  const waypoint = page.getByRole('region',{name:'Waypoint details'});
  await expect(waypoint).toContainText('17,386 LBS');
  await expect(waypoint).toContainText('14:55Z');
  await expect(waypoint).toContainText('-49 °C');
  await page.getByRole('button',{name:'Fit route',exact:true}).click();
  const map = page.getByRole('group',{name:'Interactive planned route'});
  await map.focus(); await page.keyboard.press('+');
  await expect(page.getByLabel('Map zoom')).toHaveText('140%');
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Map zoom')).toHaveText('100%');
  await map.hover(); await page.keyboard.down('Control'); await page.mouse.wheel(0,-100); await page.keyboard.up('Control');
  await expect(page.getByLabel('Map zoom')).toHaveText('120%');
  await page.mouse.wheel(0,40);
  await expect(page.getByLabel('Map zoom')).toHaveText('120%');
  await page.getByRole('button',{name:'Fit route',exact:true}).click();
  await page.locator('.route-map').screenshot({path:'artifacts/map-detail.png'});
  await page.getByRole('button',{name:'Expand route map'}).click();
  await expect(page.getByRole('dialog',{name:'Expanded route map'})).toBeVisible();
  await expect(waypoint).toContainText('TOC');
  await page.screenshot({path:'artifacts/map-expanded.png'});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Expanded route map'})).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Expand route map'})).toBeFocused();
  await page.getByRole('button',{name:'Inspect TOC',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(waypoint).toContainText('Top of climb');

  await expect(page.getByText('119.500',{exact:true})).toBeVisible();
  await expect(page.getByText('120.500',{exact:true})).toBeVisible();
  await expect(page.getByText('Not yet filed',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Planned fuel',exact:true})).toContainText('21,690');
  await expect(page.getByRole('region',{name:'Planned winds and cruise'})).toContainText('4 kt headwind');
  await expect(page.getByRole('region',{name:'SID and STAR'})).toContainText('BAYPO2');
  await expect(page.getByRole('region',{name:'SID and STAR'})).toContainText('CAMJO');
  await expect(page.getByRole('region',{name:'SID and STAR'})).toHaveCount(1);
  expect(await page.locator('.gate-card').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.procedures-card')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(await page.locator('.procedures-card').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.timing-card')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);

  expect(await page.locator('.gate-card').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.ofp-details')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByText('Not specified in OFP')).toHaveCount(0);
  await page.locator('.navlog-disclosure summary').click();
  await expect(page.locator('.navlog-table tbody tr')).toHaveCount(16);
  await page.screenshot({path:'artifacts/navlog.png',fullPage:true});
  await page.locator('.navlog-disclosure summary').click();
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'artifacts/briefing.png',fullPage:true});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1050,800));
  await page.screenshot({path:'artifacts/briefing-compact.png',fullPage:true});
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  // The production extension controls an isolated Chromium profile; all VATSIM
  // traffic is intercepted locally. No live plan is filed.
  companion = await launchTestCompanion(userData, route => route.fulfill(new URL(route.request().url()).hostname === 'my.vatsim.net' ? {contentType:'text/html',body:filingPage(vatsimFields(parseOFP(ofp)))} : {status:403,body:'Blocked by local test'}));
  await expect.poll(() => page.evaluate(() => window.dispatch.companionStatus().then(s=>s.connected))).toBe(true);
  await page.getByRole('button',{name:'File automatically on VATSIM'}).click();
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:45000});
  await expect(page.getByText('Filed on VATSIM',{exact:true})).toBeVisible();
  const filed = JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'))[0];
  expect(filed.filing.status).toBe('filed');
  expect(filed.filing.message).toContain('Local test only.');
  // Opening the briefing already started detection; no tracking click is needed.
  await expect(page.getByRole('button',{name:'Stop tracking'})).toBeVisible();
  const plannedDeparture = Date.parse(filed.ofp.timing.out.estimated || filed.offBlock);
  const countdown = page.getByRole('region',{name:'Off-block countdown'});
  await page.clock.setFixedTime(new Date(plannedDeparture-601000));
  await expect(countdown).toHaveClass(/countdown$/);
  await expect(countdown.locator('strong')).toHaveCSS('color','rgb(212, 237, 177)');
  await page.clock.setFixedTime(new Date(plannedDeparture-600000));
  await expect(countdown).toHaveClass(/soon/);
  await expect(countdown.locator('strong')).toHaveCSS('color','rgb(255, 180, 93)');
  const banner = page.getByRole('region',{name:'Flight summary'});
  const bannerBounds = await banner.boundingBox(), overviewBounds = await page.locator('.briefing-overview').boundingBox();
  expect(bannerBounds.height).toBeLessThan(160);
  expect(Math.abs(bannerBounds.width-overviewBounds.width)).toBeLessThan(2);
  expect(bannerBounds.y+bannerBounds.height).toBeLessThan(overviewBounds.y);
  expect(await countdown.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.airport-grid')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'artifacts/briefing-banner-compact.png'});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1380,940));
  await page.screenshot({path:'artifacts/briefing-banner.png'});
  await page.clock.setFixedTime(new Date(plannedDeparture-30000));
  await expect(countdown).toContainText('00:00:30');
  await page.clock.setFixedTime(new Date(plannedDeparture-29000));
  await expect(countdown).toContainText('00:00:29');
  await countdown.screenshot({path:'artifacts/offblock-countdown.png'});
  await page.clock.setFixedTime(new Date(plannedDeparture+1000));
  await expect(countdown).toContainText('OFF BLOCKS OVERDUE');
  await expect(countdown).toContainText('+00:00:01');
  await expect(countdown.locator('strong')).toHaveCSS('color','rgb(255, 154, 152)');
  await countdown.screenshot({path:'artifacts/offblock-overdue.png'});
  await page.clock.setFixedTime(new Date(filed.offBlock));
  const telemetryBase = await page.evaluate(() => Date.now());
  await app.evaluate((_, base) => {
    globalThis.__telemetryBase = base;
    for (let ms = 0; ms <= 4000; ms += 100) globalThis.__sample({ at:base+ms, simTime:ms/1000, simulator:'Local telemetry fixture',
      onGround:true, agl:0, verticalSpeed:0, groundspeed:ms<1000?0:10, lat:42.94, lon:-78.73, parkingBrake:ms<1000 });
  }, telemetryBase);
  const timings = page.getByRole('region',{name:'Live flight timings'});
  await expect(timings).toContainText('Taxiing out');
  await expect(countdown).toHaveCount(0);
  await page.clock.setFixedTime(new Date(telemetryBase+6500));
  await expect(timings.getByRole('row').filter({hasText:'Taxi-out'})).toContainText('00:00:05');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await app.evaluate(() => {
    for (let ms = 4100; ms <= 7200; ms += 100) globalThis.__sample({ at:globalThis.__telemetryBase+ms, simTime:ms/1000, simulator:'Local telemetry fixture',
      onGround:ms>=7200, agl:ms>=7200?0:100, verticalSpeed:-180, groundspeed:130, lat:42.94, lon:-78.73, pitch:3, bank:1 });
  });
  const popup = page.getByRole('dialog',{name:'Your landing rate'});
  await expect(popup).toContainText('-180');
  await expect(popup).toContainText('Estimated');
  const popupBounds = await popup.boundingBox(), viewport = await page.evaluate(() => ({width:document.documentElement.clientWidth,height:innerHeight}));
  expect(Math.abs(popupBounds.x + popupBounds.width/2 - viewport.width/2)).toBeLessThan(2);
  expect(Math.abs(popupBounds.y + popupBounds.height/2 - viewport.height/2)).toBeLessThan(2);
  await page.screenshot({path:'artifacts/landing-popup.png'});
  await popup.getByRole('button',{name:'View briefing'}).click();
  await expect(popup).toHaveCount(0);
  await expect(timings).toContainText('Taxiing in');
  // A native measurement arriving a frame later updates the page, not a dismissed popup.
  await app.evaluate(() => {
    for (let ms = 7300; ms <= 12400; ms += 100) globalThis.__sample({ at:globalThis.__telemetryBase+ms, simTime:ms/1000, simulator:'Local telemetry fixture',
      onGround:true, agl:0, verticalSpeed:0, touchdownVelocity:3, groundspeed:0, lat:42.94, lon:-78.73, pitch:3, bank:1, parkingBrake:true });
  });
  await expect(popup).toHaveCount(0);
  await expect(timings).toContainText('Flight complete');
  await expect(timings.getByRole('row').filter({hasText:'Taxi-out'})).toContainText('00:00:03');
  await expect(timings.getByRole('row').filter({hasText:'Air time'})).toContainText('00:00:03');
  await expect(page.getByRole('region',{name:'Landing summary'})).toContainText('-180');
  await expect(page.getByRole('region',{name:'Landing summary'})).toContainText('Flight complete');
  await expect(page.getByRole('region',{name:'Landing summary'})).toContainText('Simulator touchdown measurement');
  await page.getByRole('region',{name:'Landing summary'}).screenshot({path:'artifacts/landing-summary.png'});
  const landed = JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'))[0];
  expect(landed.landing.contacts[0].rateFpm).toBe(-180);
  expect(landed.landing.completedAt).toBeTruthy();
  expect(landed.actual.out).toBe(new Date(telemetryBase+1000).toISOString());
  expect(landed.actual.off).toBe(new Date(telemetryBase+4100).toISOString());
  expect(landed.actual.on).toBe(new Date(telemetryBase+7200).toISOString());
  expect(landed.actual.in).toBe(new Date(telemetryBase+7300).toISOString());
  await timings.screenshot({path:'artifacts/live-timings.png'});
  await page.clock.setFixedTime('2027-01-01T01:05:42Z');

  await page.getByRole('button',{name:'Recent flights 1'}).click();
  await page.getByLabel('Filter recent flights').selectOption('complete');
  await expect(page.locator('.history-row')).toHaveCount(1);
  await expect(page.locator('.history-row')).toContainText('Flight complete');
  await page.getByRole('button',{name:'Import latest',exact:true}).click();
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:60000});
  const imported = JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'))[0];
  await expect(page.locator('.callsign-link')).toHaveText(imported.callsign);
  expect(imported.landing.contacts[0].rateFpm).toBe(-180);
  expect(imported.actual).toEqual(landed.actual);
  await expect(page.getByRole('region',{name:'Landing summary'})).toContainText('Flight complete');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1380,940));
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'artifacts/briefing-live.png',fullPage:true});
  await page.getByRole('button',{name:'Edit & regenerate'}).click();
  await expect(page.getByLabel('Taxi out minutes')).not.toHaveValue('');
  await expect(page.getByLabel('Callsign',{exact:true})).toHaveValue(imported.airline);
  await expect(page.getByLabel('Departure date')).toHaveValue(imported.offBlock.slice(0,10));
  await expect(page.getByLabel('Off block time')).toHaveValue(imported.offBlock.slice(11,16));
  await expect(page.locator('.route-map')).toHaveCount(0);
  await page.getByRole('button',{name:'New flight',exact:true}).click();
  await expectNewFlight();
  // Reproduce an older briefing owning a connected aircraft before importing
  // the Fenix flight, then check the explicit correction for an active taxi.
  const importTrackingFixture = async (id, callsign, aircraft) => {
    await app.evaluate(({app}, fixture) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
      require('./electron/services.mjs').Services.prototype.ofp = async () => fixture;
    }, { ...parseOFP(ofp), id, callsign, aircraft });
    await page.getByRole('button',{name:/^Recent flights \d+$/}).click();
    await page.getByRole('button',{name:'Import latest',exact:true}).click();
    await expect(page.locator('.progress')).toHaveCount(0,{timeout:60000});
    await expect(page.locator('.callsign-link')).toHaveText(callsign);
  };
  await importTrackingFixture('tracking-previous', 'SWA456', 'B738');
  await app.evaluate(() => globalThis.__sample({ at:Date.now(), simTime:100, simulator:'Local telemetry fixture',
    onGround:true, agl:0, verticalSpeed:0, groundspeed:0, lat:42.94, lon:-78.73, parkingBrake:true }));
  // Keep telemetry fresh while the import performs its read-only enrichment.
  await app.evaluate(() => { globalThis.__parkedTimer = setInterval(() => globalThis.__sample({at:Date.now(), simTime:Date.now()/1000,
    simulator:'Local telemetry fixture',onGround:true,agl:0,verticalSpeed:0,groundspeed:0,lat:42.94,lon:-78.73,parkingBrake:true}),100); });
  await importTrackingFixture('tracking-fenix', 'DAL321', 'A321');
  await app.evaluate(() => clearInterval(globalThis.__parkedTimer));
  expect((await page.evaluate(() => window.dispatch.bootstrap())).telemetry.planId).toBe('tracking-fenix');
  await expect(page.getByRole('region',{name:'Flight recording mismatch'})).toHaveCount(0);
  await app.evaluate(() => {
    const base = Date.now();
    for (let ms = 0; ms <= 3000; ms += 100) globalThis.__sample({at:base+ms,simTime:base/1000+ms/1000,
      simulator:'Local telemetry fixture',onGround:true,agl:0,verticalSpeed:0,groundspeed:ms===0?0:6,
      lat:42.94,lon:-78.73,parkingBrake:ms===0});
  });
  await expect(timings).toContainText('Taxiing out');
  const fenixBeforeSwitch = (await page.evaluate(() => window.dispatch.bootstrap())).history.find(p=>p.id==='tracking-fenix');
  expect(fenixBeforeSwitch.actual.out).toBeTruthy();
  await importTrackingFixture('tracking-correction', 'DAL322', 'A321');
  const mismatch = page.getByRole('region',{name:'Flight recording mismatch'});
  await expect(timings).toContainText('Not recording this flight');
  await expect(mismatch).toContainText('DAL321');
  await expect(mismatch).toContainText('DAL322');
  await mismatch.scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/tracking-mismatch.png'});
  await mismatch.getByRole('button',{name:'Track this flight',exact:true}).click();
  await expect(mismatch).toHaveCount(0);
  const switched = await page.evaluate(() => window.dispatch.bootstrap());
  expect(switched.telemetry.planId).toBe('tracking-correction');
  expect(switched.history.find(p=>p.id==='tracking-fenix').actual.out).toBe(fenixBeforeSwitch.actual.out);
  expect(switched.history.find(p=>p.id==='tracking-correction').actual).toBeUndefined();
  console.log('Tracking handoff passed: parked import switches briefing, taxi remains attached, explicit correction saves the previous flight without copying its times.');
  expect(errors).toEqual([]);
  console.log('Desktop smoke passed: new flight UTC + 30 minute defaults with midnight/year rollover and fresh resets, manual and edit/regenerate times preserved, saved variant defaults on aircraft selection, map only in briefing, CI rules, custom route, passenger modes, map waypoint inspector, keyboard/scroll zoom, expanded dialog, procedure order, landing summary and history persistence, OFP details, SID/STAR, navlog, settings, history, sample import, compact layout, automatic VATSIM submission against a local form, and no renderer errors.');
} finally { await companion?.close(); await app.close(); }
