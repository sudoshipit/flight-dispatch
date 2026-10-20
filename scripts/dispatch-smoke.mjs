import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOFP, vatsimFields, DEFAULT_SETTINGS } from '../shared/domain.mjs';
import { ofp, aircraft as baseAircraft, input } from '../tests/fixtures.mjs';
import { filingPage } from '../tests/filing-page.mjs';
import { launchTestCompanion } from './companion-test-client.mjs';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-flow-'));
fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
fs.writeFileSync(path.join(userData, 'data/settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, simbriefId: 'test-pilot' }));
fs.copyFileSync('data/aircraft.json', path.join(userData, 'data/aircraft.json'));
const plan = { ...parseOFP(ofp), id: 'automated-dispatch' };
const route = 'CAMJO Q99 HEPAR';
const variant = { id:'746599_1776105415884', name:'PMDG Dual Class', maxPassengers:124, icao:'B737', registration:'N123FD', source:'SimBrief' };
const aircraft = baseAircraft.map(a => a.id === 'B737' ? {...a,variants:[variant]} : a);
plan.passengers = 124;
const form = Object.entries({ airline:'SWA', fltnum:'123', orig:'KTPA', dest:'KBUF', type:variant.id, pax:'124', taxiout:'20', taxiin:'8', resvrule:'45', addedfuel:'10', addedfuel_units:'min', fl:'37000', altn:'KROC', cruisemode:'CI', cruisesub:'40' }).map(([name,value])=>`<input name="${name}" value="${value}">`).join('');
const simbriefHtml = `<!doctype html><title>Local SimBrief test form</title>${form}<textarea name="route">${route}</textarea><button onclick="fetch('/test-generated')">Generate Flight</button>`;
const app = await electron.launch({ executablePath: process.env.FLIGHT_DISPATCH_EXECUTABLE, args: process.env.FLIGHT_DISPATCH_EXECUTABLE ? [] : ['.'], timeout:45000, env:{ ...process.env, FLIGHT_DISPATCH_TEST_DATA:userData } });
let companion;
const scenario = { signedIn: true, reject: false, unconfirmed: false, blocked: false, filingPages: 0 };
try {
  await app.evaluate(async ({app, session, BrowserWindow}, data) => {
    // Full-page captures need a painting window on Windows; do not take focus.
    BrowserWindow.getAllWindows().forEach(win=>{
      win.webContents.setBackgroundThrottling(false);
      win.showInactive();
    });
    const localRequire = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const { Services } = localRequire('./electron/services.mjs');
    let generated = false, staticId = '';
    globalThis.__dispatchTest = { generations: 0, filingPages: 0 };
    Services.prototype.ofp = async () => ({ ...data.plan, id: generated ? data.plan.id : 'previous', staticId, generatedAt: new Date().toISOString() });
    Services.prototype.aircraft = async () => ({ aircraft:data.aircraft, mode:'test', updatedAt:new Date().toISOString() });
    Services.prototype.airportPositions = async () => [data.plan.origin, data.plan.destination].map(p=>({ident:p.icao,lat:p.lat,lon:p.lon}));
    Services.prototype.enrich = async () => ({ weather: {}, airports: {}, gates: { departure:null,arrival:null,message:'Local test' } });
    const { BrowserSessions } = localRequire('./electron/browser.mjs');
    const create = BrowserSessions.prototype.createContext;
    const signedIn = new Set();
    globalThis.__dispatchTest.signIns = []; globalThis.__dispatchTest.requests = [];
    BrowserSessions.prototype.createInteractive = async function(url) {
      // A normal browser has no automation connection. Simulate the user signing
      // in and closing it; all background page traffic still uses real Edge.
      globalThis.__dispatchTest.signIns.push(url);
      const session = { closed: false, error: null };
      setTimeout(() => {
        signedIn.add(new URL(url).hostname);
        session.closed = true;
      }, 1500);
      return session;
    };
    BrowserSessions.prototype.createContext = async function() {
      const context = await create.call(this);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        globalThis.__dispatchTest.requests.push({host:url.hostname,path:url.pathname});
        if (url.hostname === 'my.vatsim.net') throw new Error('VATSIM must use the companion, never the SimBrief browser');
        if (url.hostname !== 'dispatch.simbrief.com') return route.fulfill({status:403,body:'Blocked by local test'});
        if (url.pathname === '/login') {
          return route.fulfill({contentType:'text/html',body:'<title>Sign in</title><input type="password">'});
        }
        if (!signedIn.has(url.hostname) && url.hostname === 'dispatch.simbrief.com') return route.fulfill({contentType:'text/html',body:'<title>SimBrief</title><div id="login"><a id="login-button">Sign In</a></div>'});
        if (!signedIn.has(url.hostname)) return route.fulfill({contentType:'text/html',body:'<script>location.href="/login"</script>'});
        if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<h1>Signed in</h1>'});
        if (url.hostname === 'dispatch.simbrief.com') {
          if(url.pathname === '/test-generated') { generated=true;globalThis.__dispatchTest.generations++;return route.fulfill({body:'ok'}); }
          if(url.searchParams.get('route') !== data.route || url.searchParams.get('taxiout') !== '20' || url.searchParams.get('type') !== data.variant.id || url.searchParams.get('pax') !== '124') return route.fulfill({status:400,body:'Wrong dispatch options'});
          staticId=url.searchParams.get('static_id');
          return route.fulfill({contentType:'text/html',body:data.simbriefHtml});
        }

      });
      return context;
    };
  }, { plan, aircraft, variant, route, simbriefHtml, vatsimHtml:filingPage(vatsimFields(plan)) });
  companion = await launchTestCompanion(userData, async request => {
    const url = new URL(request.request().url());
    if (url.hostname !== 'my.vatsim.net') return request.fulfill({status:403,body:'Blocked by local test'});
    if (url.searchParams.has('testSignedIn')) scenario.signedIn = true;
    if (scenario.blocked) return request.fulfill({contentType:'text/html',body:'<title>Just a moment...</title><h1>Verify you are human</h1>'});
    if (!scenario.signedIn) return request.fulfill({contentType:'text/html',body:`<title>Local sign in</title><button onclick="location.href=location.href+'&testSignedIn=1'">Sign In</button>`});
    scenario.filingPages++;
    let html = filingPage(vatsimFields(plan));
    // An unrelated sign-in link must not override a ready authenticated form.
    html += '<footer><a href="/login">Sign In</a></footer>';
    if (scenario.reject) html = html.replace('<option>IFR</option>','<option>VFR</option>');
    if (scenario.unconfirmed) html = html.replace('Flight plan successfully filed. Local test only.','Error: VATSIM test server unavailable.');
    return request.fulfill({contentType:'text/html',body:html});
  });
  const page=await app.firstWindow();
  await expect.poll(() => page.evaluate(() => window.dispatch.companionStatus().then(s=>s.connected))).toBe(true);
  await page.evaluate(() => { window.__stages=[]; window.dispatch.onProgress(p=>window.__stages.push(p.stage)); });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByLabel('Aircraft type')).toBeEnabled({timeout:45000});
  for(const [label,value] of [['Callsign',input.airline],['Flight number',input.flightNumber],['Departure',input.origin],['Destination',input.destination]]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Aircraft type').selectOption(input.aircraft);
  await page.getByLabel('Departure date',{exact:true}).fill(input.date);
  await page.getByLabel('Off block time').fill(input.time);
  await page.getByLabel('Custom route',{exact:true}).fill(route);
  await page.getByLabel('Variant or airframe',{exact:true}).selectOption(variant.id);
  await page.getByRole('button',{name:'Full flight'}).click();
  for(const [label,value] of [['Taxi out minutes','20'],['Taxi in minutes','8'],['Extra fuel minutes','10'],['Cruise altitude feet','37000'],['Alternate airport','KROC']]) await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Final reserve',{exact:true}).selectOption('45');
  await page.getByRole('button',{name:'Generate & file flight plan'}).click();
  await expect(page.getByRole('dialog',{name:'Dispatch progress'})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Dispatch progress'}).getByRole('status')).toContainText('Sign in to SimBrief in the browser',{timeout:30000});
  await expect(page.getByRole('dialog',{name:'Dispatch progress'}).getByRole('status')).toContainText('close all Flight Dispatch browser windows');
  await page.screenshot({path:'artifacts/progress.png',fullPage:true});
  await expect(page.getByText('Filed on VATSIM',{exact:true})).toBeVisible({timeout:90000});
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:10000});
  expect(await app.evaluate(()=>globalThis.__dispatchTest.generations)).toBe(1);
  const saved=JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'))[0];
  expect(saved.filing.status).toBe('filed');expect(saved.requestedRoute).toBe(route);expect(saved.variantId).toBe(variant.id);expect(saved.planningInput.taxiOut).toBe('20');
  const signIns = await app.evaluate(()=>globalThis.__dispatchTest.signIns);
  expect(signIns).toEqual(['https://dispatch.simbrief.com']);
  expect(await page.evaluate(()=>window.__stages)).not.toContain('vatsim-sign-in');
  expect(await page.evaluate(()=>window.__stages)).not.toContain('verification');
  expect(await app.windows()).toHaveLength(1);
  expect(saved.filing.message).toContain('Local test only.');expect(errors).toEqual([]);
  // Importing remains read-only; a failed form is clearly reported before any click.
  await app.evaluate(({app}, data) => {
    const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    req('./electron/services.mjs').Services.prototype.ofp = async () => ({...data.plan,id:'failure-test'});

  }, {plan});
  scenario.reject = true;
  await page.getByRole('button',{name:'Recent flights 1'}).click();
  await page.getByRole('button',{name:'Import latest',exact:true}).click();
  await expect(page.locator('.progress')).toHaveCount(0,{timeout:10000});
  await page.getByRole('button',{name:'File automatically on VATSIM'}).click();
  await expect(page.locator('.filing-alert')).toContainText('VATSIM flight plan filing failed',{timeout:15000});
  await expect(page.locator('.filing-alert')).toContainText('Could not set VATSIM rules');
  await page.screenshot({path:'artifacts/filing-failed.png',fullPage:true});
  scenario.reject=false; scenario.unconfirmed=true;
  await page.getByRole('button',{name:'Retry automatic filing'}).click();
  await expect(page.locator('.filing-alert')).toContainText('VATSIM submission could not be confirmed',{timeout:15000});
  await expect(page.getByRole('button',{name:'Retry automatic filing'})).toHaveCount(0);
  await expect(page.locator('.filing-alert')).toContainText('VATSIM test server unavailable');
  const state=JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8')).find(p=>p.id==='failure-test');
  expect(state.filing.status).toBe('unconfirmed');
  expect(errors).toEqual([]);
  // An expired session is resumed in the same tab and browser after sign-in.
  const importPlan = async id => {
    await app.evaluate(({app}, data) => {
      const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
      req('./electron/services.mjs').Services.prototype.ofp=async()=>({...data.plan,id:data.id});
    },{plan,id});
    await page.getByRole('button',{name:/^Recent flights/}).click();
    await page.getByRole('button',{name:'Import latest',exact:true}).click();
    await expect(page.locator('.progress')).toHaveCount(0,{timeout:10000});
  };
  scenario.unconfirmed=false; scenario.signedIn=false;
  await importPlan('login-test');
  await page.getByRole('button',{name:'File automatically on VATSIM'}).click();
  await expect(page.getByRole('dialog',{name:'Dispatch progress'}).getByRole('status')).toContainText('Sign in to VATSIM in your browser',{timeout:15000});
  const tabs = companion.context.pages();
  const loginTab = tabs[tabs.length-1];
  // This is the local fixture's login control, not a real service login.
  await loginTab.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.getByText('Filed on VATSIM',{exact:true})).toBeVisible({timeout:15000});
  expect(loginTab.isClosed()).toBe(true);
  expect(await app.evaluate(()=>globalThis.__dispatchTest.signIns)).toEqual(['https://dispatch.simbrief.com']);
  // Verification is labelled separately from authentication. Cancelling before
  // completion does not submit and never reopens a second login browser.
  scenario.blocked=true;
  await importPlan('challenge-test');
  const beforeChallenge=scenario.filingPages;
  await page.getByRole('button',{name:'File automatically on VATSIM'}).click();
  const progress=page.getByRole('dialog',{name:'Dispatch progress'});
  await expect(progress.getByRole('status')).toContainText('VATSIM requires browser verification',{timeout:15000});
  await expect(progress.getByRole('status')).not.toContainText('Sign in to VATSIM');
  await progress.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.filing-alert')).toContainText('VATSIM flight plan filing failed',{timeout:15000});
  expect(scenario.filingPages).toBe(beforeChallenge);
  expect(JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8')).find(p=>p.id==='challenge-test').filing.status).toBe('failed');
  expect(errors).toEqual([]);
  console.log('Automatic dispatch passed through the real companion extension: signed-in session without auth prompt, one automatic submission, same-tab login recovery, separate verification prompt, cancellation, failure alert, and no retry after uncertain submission. All service pages were local mocks; no real flight was generated or filed.');
} catch(error) { console.error('Flow diagnostics',await app.evaluate(()=>globalThis.__dispatchTest)); throw error; } finally { await companion?.close(); await app.close(); }
