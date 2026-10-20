import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseOFP } from '../shared/domain.mjs';
import { ofp } from '../tests/fixtures.mjs';
const toXml = (value, key = 'OFP') => Array.isArray(value) ? value.map(v => toXml(v, key)).join('') : `<${key}>${value && typeof value === 'object' ? Object.entries(value).map(([k,v]) => toXml(v,k)).join('') : String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</${key}>`;
const userData = fs.mkdtempSync(path.join(os.tmpdir(),'flight-dispatch-import-'));
fs.mkdirSync(path.join(userData,'data'));
fs.writeFileSync(path.join(userData,'data/settings.json'),JSON.stringify({...DEFAULT_SETTINGS,simbriefId:'test-pilot'}));
fs.copyFileSync('data/aircraft.json',path.join(userData,'data/aircraft.json'));
const row = (id, callsign, date) => `<div class="row-item"><span data-key="flight_number">${callsign}</span><span data-key="origin_icao">KTPA</span><span data-key="destination_icao">KBUF</span><span data-key="aircraft_icao">B737</span><span data-key="aircraft_registration">N123FD</span><span data-key="release_number">1</span><span class="sort-value" data-key="departure_time">${date}</span><span class="sort-value" data-key="generated_time">${date}</span><a data-key="request_id" href="./briefing/${id}">View</a></div>`;
const html = `<main id="flights"><div id="flights-history">${row('newest','DAL456','2028-01-02T12:00:00')}${row('test-123','SWA123','2027-12-31T23:50:00')}</div></main>`;
const app = await electron.launch({executablePath:process.env.FLIGHT_DISPATCH_EXECUTABLE,args:process.env.FLIGHT_DISPATCH_EXECUTABLE?[]:['.'],env:{...process.env,FLIGHT_DISPATCH_TEST_DATA:userData},timeout:45000});
try {
  await app.evaluate(({app,BrowserWindow},data)=>{
    const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    BrowserWindow.getAllWindows().forEach(w=>w.showInactive());
    const {Services}=require('./electron/services.mjs');
    Services.prototype.enrich=async()=>({weather:{},airports:{},gates:{departure:null,arrival:null}});
    Services.prototype.ofp=async()=>({...data.plan,id:'latest-plan'});
    Services.prototype.ofpFile=async url=>{if(url!=='https://www.simbrief.com/ofp/flightplans/xml/test-123.xml')throw Error('Wrong selected OFP');return data.xml;};
    const {Telemetry}=require('./electron/telemetry.mjs');Telemetry.prototype.follow=function(){return this.status();};
    const {BrowserSessions}=require('./electron/browser.mjs'), create=BrowserSessions.prototype.createContext;
    let signedIn=false;globalThis.__importSignIns=0;
    BrowserSessions.prototype.createInteractive=async()=>{signedIn=true;globalThis.__importSignIns++;return {closed:true};};
    BrowserSessions.prototype.createContext=async function(){
      const context=await create.call(this);
      await context.route('**/*',route=>{
        const u=new URL(route.request().url());
        if(u.hostname!=='dispatch.simbrief.com')return route.abort();
        if(!signedIn)return route.fulfill({contentType:'text/html',body:'<title>SimBrief</title><button>Sign In</button>'});
        const body=u.pathname==='/flights/all'?data.html:u.pathname==='/briefing/test-123'?'<main id="briefing"><a href="https://www.simbrief.com/ofp/flightplans/xml/test-123.xml">XML Datafile</a></main>':'<main>Unexpected flight</main>';
        return route.fulfill({contentType:'text/html',body});
      });return context;
    };
  },{plan:parseOFP(ofp),xml:toXml(ofp),html});
  const page=await app.firstWindow();
  await page.getByRole('button',{name:'Choose from SimBrief',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Choose a flight plan'});
  await expect(picker.getByRole('radio')).toHaveCount(2,{timeout:45000});
  await expect(picker.getByRole('button',{name:'Import selected flight'})).toBeDisabled();
  await picker.getByLabel('Search SimBrief flights').fill('SWA');
  await expect(picker.getByRole('radio')).toHaveCount(1);
  await picker.getByRole('radio').check();
  await page.screenshot({path:'artifacts/simbrief-picker.png'});
  await picker.getByRole('button',{name:'Import selected flight'}).click();
  await expect(picker).toHaveCount(0,{timeout:45000});
  await expect(page.getByRole('region',{name:'Flight summary'})).toContainText('SWA123');
  const saved=JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'));
  expect(saved[0].id).toBe('test-123');expect(saved[0].filing.status).toBe('not-filed');
  expect(await app.evaluate(()=>globalThis.__importSignIns)).toBe(1);
  await page.getByRole('button',{name:/New flight/}).first().click();
  await page.getByRole('button',{name:'Import latest from SimBrief'}).click();
  await expect.poll(()=>JSON.parse(fs.readFileSync(path.join(userData,'data/history.json'),'utf8'))[0].id).toBe('latest-plan');
  console.log('PASS: saved-flight picker, sign-in resumption, search, exact older OFP import, no filing, and separate Import latest.');
} finally {await app.close();}
