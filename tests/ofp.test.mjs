import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOFP, validateFlight, simbriefUrl, DEFAULT_RULES } from '../shared/domain.mjs';
import { parseOfpDetails, formatSeconds, formatWind, formatWindComponent } from '../shared/ofp.mjs';
import { routeGeometry, routeProjection } from '../shared/map.mjs';
import { ofp, aircraft, input } from './fixtures.mjs';

test('custom route is normalized, encoded, optional, and validated', () => {
  const flight = validateFlight({ ...input, route: '  dct CAMJO\n q99  HEPAR  /n0460f370 ' }, aircraft, DEFAULT_RULES);
  assert.equal(flight.route, 'DCT CAMJO Q99 HEPAR /N0460F370');
  assert.equal(new URL(simbriefUrl(flight, 'test')).searchParams.get('route'), flight.route);
  assert.equal(new URL(simbriefUrl(validateFlight(input, aircraft, DEFAULT_RULES), 'test')).searchParams.has('route'), false);
  for (const route of ['<script>', 'DCT&dest=FAKE', 'A'.repeat(2001), {}]) assert.throws(() => validateFlight({ ...input, route }, aircraft, DEFAULT_RULES));
});
test('OFP fuel, winds, times, procedures, weights and navlog match the source fields', () => {
  const plan = parseOFP(ofp), d = plan.ofp;
  assert.equal(d.airac, '2610'); assert.equal(d.cruise.profile, 'CI 40');
  assert.equal(d.fuel.block, 21690); assert.equal(d.fuel.landing, 8161); assert.equal(d.fuel.trip, 13029);
  assert.equal(d.fuel.contingency, 1325); assert.equal(d.fuel.reserve, 2161); assert.equal(d.fuel.extra, 2715); assert.equal(d.fuel.etops, 0);
  assert.equal(d.weights.zeroFuel, 117215); assert.equal(d.weights.takeoff, 138405); assert.equal(d.weights.landing, 125376);
  assert.equal(d.timing.off.estimated, '2026-10-19T14:35:00.000Z'); assert.equal(d.timing.in.estimated, '2026-10-19T17:10:28.000Z');
  assert.equal(d.timing.blockSeconds, 10528); assert.equal(d.cruise.windComponent, -4); assert.equal(d.cruise.isaDeviation, 6);
  assert.deepEqual(d.procedures.departure, { name: 'BAYPO2', transition: 'CAMJO', runway: '01R' });
  assert.deepEqual(d.procedures.arrival, { name: '', transition: '', runway: '23' });
  const toc = d.navlog.find(f=>f.ident==='TOC');
  assert.equal(toc.eta,'2026-10-19T14:55:13.000Z'); assert.equal(toc.temperature,-49); assert.equal(toc.fuelRemaining,17386);
});
test('missing and malformed optional OFP values do not become zeros or estimates', () => {
  const d = parseOfpDetails({ general: { avg_wind_dir: '-5', avg_wind_spd: {}, avg_temp_dev: ' ', cruise_mach: 'NaN' }, fuel: { plan_ramp: {}, taxi: '', etops: '0', extra: -1 }, times: { est_off: '1e40', sched_off: 1792420500 }, navlog: { fix: { ident: 'TEST', pos_lat: '95', pos_long: '0', time_total: '0', wind_dir: '400', wind_spd: '0', oat: '0' } } });
  assert.equal(d.fuel.block,null); assert.equal(d.fuel.taxi,null); assert.equal(d.fuel.extra,null); assert.equal(d.fuel.etops,0);
  assert.equal(d.cruise.windDirection,null); assert.equal(d.cruise.isaDeviation,null); assert.equal(d.cruise.mach,null);
  assert.equal(d.navlog.length,1); assert.equal(d.navlog[0].lat,null); assert.equal(d.navlog[0].lon,0); assert.equal(d.navlog[0].temperature,0);
  assert.equal(d.navlog[0].eta,null); assert.equal(d.timing.off.estimated,null); assert.ok(d.timing.off.scheduled);
  assert.equal(parseOfpDetails({navlog:{fix:{}}}).navlog.length,0);
});
test('UTC waypoint estimates cross midnight and preserve kilograms without conversion', () => {
  const data = structuredClone(ofp); data.params.units='kgs'; data.times.est_off=Date.parse('2026-10-19T23:50:00Z')/1000;
  data.navlog={fix:{ident:'NIGHT',time_total:'1200'}}; data.fuel.plan_ramp='9800'; data.general.avg_wind_comp='P014';
  const p=parseOFP(data); assert.equal(p.units,'KGS'); assert.equal(p.ofp.fuel.block,9800); assert.equal(p.ofp.navlog[0].eta,'2026-10-20T00:10:00.000Z');
  assert.equal(formatWindComponent(p.ofp.cruise.windComponent),'14 kt tailwind');
  assert.equal(formatWindComponent(-4),'4 kt headwind'); assert.equal(formatWindComponent(0),'Neutral');
  assert.equal(formatWind(null,0),'Calm'); assert.equal(formatWind(290,16),'290° / 16 kt'); assert.equal(formatWind(null,16),'—');
  assert.equal(formatSeconds(10528),'2h 55m'); assert.equal(formatSeconds(0),'0h 00m'); assert.equal(formatSeconds(null),'—');
});
test('map preserves unknown-coordinate gaps and fits antimeridian and polar routes', () => {
  assert.deepEqual(routeGeometry([{lat:10,lon:20},{lat:null,lon:30},{lat:20,lon:40},{lat:21,lon:42}]).coordinates, [[[40,20],[42,21]]]);
  for(const points of [[{lat:40,lon:170},{lat:45,lon:-170}],[{lat:80,lon:-90},{lat:85,lon:0},{lat:80,lon:90}],[{lat:0,lon:0},{lat:0,lon:0}],[]]) {
    const p=routeProjection(points);
    for(const point of points) { const xy=p([point.lon,point.lat]); assert.ok(xy.every(Number.isFinite)); assert.ok(xy[0]>=0&&xy[0]<=480&&xy[1]>=0&&xy[1]<=300); }
  }
});
