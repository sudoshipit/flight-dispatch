import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { Services } from '../electron/services.mjs';
import { DEFAULT_SETTINGS, parseOFP } from '../shared/domain.mjs';
import { ofp } from './fixtures.mjs';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'flight-dispatch-unit-'));
  const secure = { isEncryptionAvailable:()=>true, encryptString:s=>Buffer.from('encrypted:'+s), decryptString:b=>b.toString().replace('encrypted:','') };
  const store = new Store(directory,secure);
  const services = new Services(store);
  const plan = parseOFP(ofp); plan.offBlock = new Date().toISOString();
  return {store,services,plan,directory};
}

test('fresh settings have no account or history and OFP lookup requires explicit setup', async () => {
  const {store,services} = setup(); let calls = 0;
  assert.equal(store.settings().simbriefId, '');
  assert.deepEqual(store.read('history', []), []);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected account lookup'); };
  try { await assert.rejects(services.ofp(), /Settings/); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
});
test('keys are absent from public settings and removal preserves the other key', () => {
  const {store} = setup();
  store.saveSettings({...DEFAULT_SETTINGS,aviationstackKey:'key-one',flightawareKey:'key-two'});
  assert.equal(store.secret('aviationstack'),'key-one');
  assert.equal(store.publicSettings().hasAviationstackKey,true);assert.ok(!JSON.stringify(store.publicSettings()).includes('key-one'));
  store.saveSettings({...DEFAULT_SETTINGS,aviationstackKey:'',removeaviationstackKey:true});
  assert.equal(store.secret('aviationstack'),''); assert.equal(store.secret('flightaware'),'key-two');
});
test('current METAR lookup is batched and cached; missing observations remain unavailable', async () => {
  const {services,plan}=setup(); let calls=0;
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{ calls++;return new Response(JSON.stringify([{icaoId:'KTPA',rawOb:'KTPA CURRENT',obsTime:Math.floor(Date.now()/1000),fltCat:'VFR'}])); };
  try {
    const first=await services.weather(plan);const second=await services.weather(plan);
    assert.equal(calls,1);assert.equal(first.KTPA.raw,'KTPA CURRENT');assert.equal(second.KTPA.stale,false);assert.equal(first.KBUF.source,'SimBrief snapshot');assert.equal(first.KBUF.stale,true);
  }finally{globalThis.fetch=original;}
});
test('VATSIM AIP only designates CTAF when flagged and keeps multiple assigned frequencies', async () => {
  const {services}=setup();const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{icao:'KTPA',altitude_ft:26,stations:[{frequency:'119.500',ctaf:true},{frequency:'120.100',ctaf:true},{frequency:'121.700',ctaf:false}]}}));
  try{const data=await services.airport('KTPA');assert.equal(data.elevation,26);assert.deepEqual(data.frequencies.map(f=>f.frequency),['119.500','120.100']);}finally{globalThis.fetch=original;}
});

test('cached missing METARs use the currently opened flight snapshot instead of another briefing', async () => {
  const { services, plan } = setup(); const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify([])); };
  try {
    const first = { ...plan, destination: { ...plan.destination, metar: 'KBUF FIRST SNAPSHOT', metarTime: '2026-10-19T10:00:00Z' } };
    const second = { ...plan, destination: { ...plan.destination, metar: 'KBUF SECOND SNAPSHOT', metarTime: '2026-10-19T12:00:00Z' } };
    assert.equal((await services.weather(first)).KBUF.raw, 'KBUF FIRST SNAPSHOT');
    const weather = await services.weather(second);
    assert.equal(weather.KBUF.raw, 'KBUF SECOND SNAPSHOT');
    assert.equal(weather.KBUF.observedAt, '2026-10-19T12:00:00Z');
    assert.equal(weather.KBUF.stale, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});
test('gate requests are deduplicated, cached, and never call historical endpoints', async () => {
  const {services,store,plan}=setup();store.saveSettings({...DEFAULT_SETTINGS,aviationstackKey:'test-key'});let calls=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    calls++;const parsed=new URL(url);assert.equal(parsed.pathname,'/v1/flights');assert.equal(parsed.searchParams.get('flight_date'),null);assert.equal(parsed.searchParams.get('flight_icao'),'SWA123');
    return new Response(JSON.stringify({data:[{flight:{icao:'SWA123'},departure:{icao:'KTPA',gate:'C30',scheduled:plan.offBlock},arrival:{icao:'KBUF',gate:'14'}},{flight:{icao:'SWA123'},departure:{icao:'KTPA',gate:'WRONG',scheduled:plan.offBlock},arrival:{icao:'KATL',gate:'WRONG'}}]}));
  };
  try{
    const [a,b]=await Promise.all([services.gates(plan),services.gates(plan)]);assert.equal(calls,1);assert.equal(a.departure.value,'C30');assert.equal(b.arrival.value,'14');
    const cached=await services.gates(plan);assert.equal(calls,1);assert.equal(cached.cached,true);
  }finally{globalThis.fetch=original;}
});
test('local request quota stops requests even when the previous provider call failed', async () => {
  const {services,store,plan}=setup();store.saveSettings({...DEFAULT_SETTINGS,gateMonthlyLimit:1,aviationstackKey:'test-key'});let calls=0;const original=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;return new Response('quota',{status:429});};
  try{
    const first=await services.gates(plan);assert.match(first.message,/429/);
    const next=await services.gates({...plan,callsign:'SWA825',flightNumber:'825'});assert.equal(calls,1);assert.match(next.message,/Monthly app limit/);
  }finally{globalThis.fetch=original;}
});
test('saved gate suggestions remain accessible without a key, with historical provenance', async () => {
  const {services,store,plan}=setup();const yesterday=new Date(Date.now()-86400000).toISOString();
  store.write('gate-history',[{callsign:plan.callsign,origin:plan.origin.icao,destination:plan.destination.icao,date:yesterday,departureGate:'C31',arrivalGate:'15',source:'Aviationstack'}]);
  const result=await services.gates(plan);assert.equal(result.needsKey,true);assert.equal(result.departure.historical,true);assert.equal(result.departure.date,yesterday);
});
test('airport preview coordinates are validated, batched, deduplicated and cached', async () => {
  const {services}=setup();let calls=0;const original=globalThis.fetch;
  globalThis.fetch=async url=>{ calls++; assert.equal(new URL(url).pathname,'/api/data/airport'); return new Response(JSON.stringify([{icaoId:'KTPA',lat:27.9755,lon:-82.5332},{icaoId:'KBUF',lat:42.9404,lon:-78.7306},{icaoId:'BAD',lat:0,lon:0}])); };
  try{
    const [a,b]=await Promise.all([services.airportPositions(['KTPA','KBUF']),services.airportPositions(['KTPA','KBUF'])]);
    assert.equal(calls,1);assert.equal(a[0].ident,'KTPA');assert.equal(b[1].lat,42.9404);
    assert.deepEqual(await services.airportPositions(['KBUF','KTPA']),[a[1],a[0]]); assert.equal(calls,1);
    await assert.rejects(services.airportPositions(['../../secret'])); await assert.rejects(services.airportPositions(['KTPA','KBUF','KATL']));
  }finally{globalThis.fetch=original;}
});
