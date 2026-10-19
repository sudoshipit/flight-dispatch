import { Services } from '../electron/services.mjs';
import { Store } from '../electron/store.mjs';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseOFP } from '../shared/domain.mjs';
import { ofp } from '../tests/fixtures.mjs';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-live-'));
const store = new Store(directory);
const testUser = process.env.SIMBRIEF_TEST_USER?.trim();
if (testUser) store.saveSettings({ ...DEFAULT_SETTINGS, simbriefId: testUser });
const services = new Services(store);
const catalog = await services.aircraft(true);
if(catalog.mode !== 'live')throw new Error(catalog.warning);
const plan = testUser ? await services.ofp() : parseOFP(ofp);
const detail = await services.enrich(plan);
for(const a of [plan.origin,plan.destination]){
  if(detail.airports[a.icao].error)throw new Error(detail.airports[a.icao].error);
  if(detail.weather[a.icao].source!=='NOAA Aviation Weather Center')throw new Error(detail.weather[a.icao].error || 'No current METAR');
}
console.log(JSON.stringify({ aircraft:catalog.aircraft.length,plan:plan.callsign,route:`${plan.origin.icao}–${plan.destination.icao}`,altitude:plan.altitude,weather:Object.values(detail.weather).map(w=>({source:w.source,observedAt:w.observedAt})),ctaf:Object.values(detail.airports).map(a=>({airport:a.icao,frequencies:a.frequencies.map(f=>f.frequency)})),gates:detail.gates.message },null,2));
