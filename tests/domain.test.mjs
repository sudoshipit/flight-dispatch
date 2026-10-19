import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, DEFAULT_SETTINGS, resolveCostIndex, validateFlight, validateSettings, simbriefUrl, parseOFP, matchGeneratedPlan, vatsimFields, vatsimUrl, hhmm, selectGates, flightInputFromPlan } from '../shared/domain.mjs';
import { ofp, aircraft, input } from './fixtures.mjs';

test('requested airline defaults and exact rule precedence', () => {
  for (const type of ['A319','A320','A321']) assert.equal(resolveCostIndex('DAL', type).costIndex, 25);
  for (const type of ['B738','B739']) assert.equal(resolveCostIndex('DAL', type).costIndex, 35);
  for (const type of ['B737','B738','B38M','A320']) assert.equal(resolveCostIndex('swa', type).costIndex, 40);
  assert.equal(resolveCostIndex('DAL','B777'), null);
  assert.equal(resolveCostIndex('SWA','B738', [...DEFAULT_RULES, { airline:'SWA', aircraft:'B738', costIndex:28 }]).costIndex, 28);
});
test('validates flight identifiers, capacity, calendar dates and maximum CI', () => {
  assert.equal(validateFlight(input, aircraft, DEFAULT_RULES).costIndex, 40);
  for (const override of [{ flightNumber:'12345' },{ airline:'WN' },{ origin:'TPA' },{ destination:'KTPA' },{ time:'24:00' },{ date:'2026-02-30' },{ aircraft:'FAKE' },{ passengerMode:'custom', passengers:'150' },{ passengerMode:'custom', passengers:'' },{ passengerMode:'custom', passengers:'1.5' }]) assert.throws(() => validateFlight({ ...input, ...override }, aircraft, DEFAULT_RULES));
  assert.equal(validateFlight({ ...input, aircraft:'C172' }, aircraft, DEFAULT_RULES).costIndex, null);
  assert.equal(validateFlight({ ...input, passengerMode:'custom', passengers:'0' }, aircraft, DEFAULT_RULES).passengers, 0);
  assert.throws(() => validateFlight(input, aircraft, [{ airline:'SWA', aircraft:'*', costIndex:999 }]));
});
test('SimBrief request includes distinct airline and flight number; loads are explicit', () => {
  const flight = validateFlight(input, aircraft, DEFAULT_RULES);
  const q = new URL(simbriefUrl(flight, 'FD_test')).searchParams;
  assert.equal(q.get('airline'),'SWA'); assert.equal(q.get('fltnum'),'123'); assert.equal(q.get('callsign'),'SWA123');
  assert.equal(q.get('pax'),'AUTO'); assert.equal(q.get('civalue'),'40'); assert.equal(q.get('cruise'),'CI'); assert.equal(q.get('date'),'19OCT26'); assert.equal(q.get('static_id'),'FD_test');
  assert.equal(new URL(simbriefUrl({ ...flight, passengerMode:'full' }, 'FD_test')).searchParams.get('pax'),'149');
  assert.equal(new URL(simbriefUrl({ ...flight, passengerMode:'custom', passengers:0 }, 'FD_test')).searchParams.get('pax'),'0');
});
test('parses real SimBrief-shaped data; object placeholders do not become NaN or object strings', () => {
  const plan = parseOFP(ofp);
  assert.equal(plan.altitude,37000); assert.equal(plan.destination.elevation,728); assert.equal(plan.enroute,'0227'); assert.equal(plan.endurance,'0410'); assert.equal(plan.ofpUrl,'https://dispatch.simbrief.com/briefing/test-123');
  const empty = structuredClone(ofp); empty.general.costindex = {}; empty.origin.elevation = {}; empty.alternate = {};
  const result = parseOFP(empty); assert.equal(result.costIndex,null); assert.equal(result.origin.elevation,null); assert.equal(result.alternate,'');
  assert.throws(() => parseOFP({ fetch:{ status:'No flight plan found.' } }));
  assert.throws(() => parseOFP({ ...ofp, times:{} }));
});
test('VATSIM output follows written overrides and blank screenshot other details', () => {
  const plan = parseOFP(ofp), f = vatsimFields(plan), url = new URL(vatsimUrl(plan)), raw = url.searchParams.get('raw');
  assert.equal(f.equipment,'L'); assert.equal(f.transponder,''); assert.equal(f.rules,'IFR'); assert.equal(f.voice,'Voice');
  assert.equal(url.searchParams.get('fuel_time'),'0410'); assert.match(raw,/-B737\/M-L\/\n/); assert.match(raw,/-KTPA1415/); assert.match(raw,/-N0460F370 /); assert.match(raw,/-KBUF0227 KROC/); assert.ok(raw.endsWith('-0)'));
  assert.doesNotMatch(raw,/LB1|PBN\/|DOF\/|REG\/|RMK\/|\bDCT\b/);
});
test('correlates generated plan against identity, route, aircraft, time, CI, pax and freshness', () => {
  const p = parseOFP(ofp), flight = validateFlight(input, aircraft, DEFAULT_RULES), started = Date.parse(p.generatedAt);
  assert.equal(matchGeneratedPlan(p, flight, started,'old','FD_new'),true);
  for (const change of [{ id:'old' },{ callsign:'SWA825' },{ staticId:'FD_other' },{ aircraft:'B738', aircraftBase:'B738' },{ costIndex:25 },{ offBlock:'2026-10-20T14:15:00Z' },{ generatedAt:'2025-10-19T13:40:00Z' }]) assert.equal(matchGeneratedPlan({ ...p, ...change },flight,started,'old','FD_new'),false);
  assert.equal(matchGeneratedPlan(p,{ ...flight, passengerMode:'full' },started,'old','FD_new'),false);
});
test('gate selection matches route and date; fills missing side from older matching flight', () => {
  const p = parseOFP(ofp), now = Date.parse('2026-10-19T17:00:00Z');
  const base = { callsign:'SWA123', origin:'KTPA', destination:'KBUF', date:'2026-10-19T14:15:00Z', source:'test' };
  const gates = selectGates([{ ...base, departureGate:'C31' },{ ...base,date:'2026-10-18T14:15:00Z',departureGate:'C30',arrivalGate:'14' },{ ...base,destination:'KATL',arrivalGate:'WRONG' },{ ...base,date:'2026-10-20T14:15:00Z',arrivalGate:'FUTURE' }],p,now);
  assert.equal(gates.departure.value,'C31'); assert.equal(gates.departure.historical,false); assert.equal(gates.arrival.value,'14'); assert.equal(gates.arrival.historical,true);
  assert.deepEqual(selectGates([{ ...base,date:'2025-10-19',arrivalGate:'OLD' }],p,now),{ departure:null,arrival:null });
});
test('settings validation prevents ambiguous or malformed rules', () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS),DEFAULT_SETTINGS);
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS,rules:[...DEFAULT_RULES,DEFAULT_RULES[0]] }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS,gateMonthlyLimit:0 }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS,rules:[{ airline:'SWA',aircraft:'*',costIndex:NaN }] }));
  assert.equal(hhmm(60),'0001'); assert.equal(hhmm(3600),'0100'); assert.throws(() => hhmm('missing'));
});

test('planning overrides preserve zero, omit defaults, and validate the SimBrief ranges', () => {
  const overrides = { taxiOut:'0', taxiIn:'5', reserve:'45', extraFuel:'20', altitude:'35000', alternate:'kroc' };
  const flight = validateFlight({ ...input, ...overrides }, aircraft, DEFAULT_RULES);
  const q = new URL(simbriefUrl(flight,'test')).searchParams;
  for (const [key,value] of Object.entries({ taxiout:'0',taxiin:'5',resvrule:'45',addedfuel:'20',addedfuel_units:'min',fl:'35000',altn:'KROC' })) assert.equal(q.get(key),value);
  const defaults = new URL(simbriefUrl(validateFlight(input,aircraft,DEFAULT_RULES),'test')).searchParams;
  for (const key of ['taxiout','taxiin','resvrule','addedfuel','fl','altn']) assert.equal(defaults.has(key),false);
  for (const override of [{taxiOut:'100'},{taxiIn:'-1'},{extraFuel:'501'},{taxiOut:'NaN'},{taxiIn:'2.5'},{altitude:'35001'},{reserve:'46'},{alternate:'ROC'}]) assert.throws(()=>validateFlight({...input,...override},aircraft,DEFAULT_RULES));
});

test('variant changes generation ID and passenger capacity while retaining base-aircraft CI', () => {
  const variants = [{id:'12345_67890',name:'128 seat layout',icao:'B737',maxPassengers:128},{id:'12345_67891',name:'Freighter',icao:'B737',maxPassengers:0}];
  const catalog = aircraft.map(a=>a.id==='B737'?{...a,variants}:a);
  const flight = validateFlight({...input,variant:variants[0].id,passengerMode:'full'},catalog,DEFAULT_RULES);
  const q = new URL(simbriefUrl(flight,'test')).searchParams;
  assert.equal(q.get('type'),'12345_67890');assert.equal(q.get('pax'),'128');assert.equal(flight.costIndex,40);
  assert.throws(()=>validateFlight({...input,variant:variants[0].id,passengerMode:'custom',passengers:'129'},catalog,DEFAULT_RULES));
  assert.throws(()=>validateFlight({...input,variant:'999_999'},catalog,DEFAULT_RULES));
  const cargo = validateFlight({...input,variant:variants[1].id,passengerMode:'full'},catalog,DEFAULT_RULES);
  assert.equal(new URL(simbriefUrl(cargo,'test')).searchParams.get('pax'),'0');
});

test('defaults migrate and edit/regenerate preserves saved requests without changing the OFP', () => {
  const settings = {...DEFAULT_SETTINGS,defaultVariants:{B737:'12345_67890'}};
  assert.deepEqual(validateSettings(settings).defaultVariants,settings.defaultVariants);
  assert.equal(validateSettings({...DEFAULT_SETTINGS,browser:undefined,defaultVariants:undefined}).browser,'auto');
  assert.throws(()=>validateSettings({...settings,defaultVariants:{B737:'https://evil.example'}}));
  const plan = parseOFP(ofp), before = structuredClone(plan);
  const edit = flightInputFromPlan(plan);assert.equal(edit.taxiOut,'20');assert.equal(edit.taxiIn,'8');assert.deepEqual(plan,before);
  const requested = {...edit,taxiOut:'0',passengerMode:'auto',variant:'12345_67890'};
  assert.deepEqual(flightInputFromPlan({...plan,planningInput:requested}),requested);
});
