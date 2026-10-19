// SimBrief's JSON uses empty objects for omitted XML elements. Keep missing
// values distinct from zero, especially for fuel, calm winds and temperatures.
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
export function ofpNumber(value) {
  const raw = text(value).replace(/^P(?=\d)/i, '+').replace(/^M(?=\d)/i, '-');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
const positive = value => { const n = ofpNumber(value); return n !== null && n >= 0 ? n : null; };
const coordinate = (value, limit) => { const n = ofpNumber(value); return n !== null && Math.abs(n) <= limit ? n : null; };
const direction = value => { const n = positive(value); return n !== null && n <= 360 ? n : null; };
function timestamp(value) {
  const n = positive(value);
  if (!n || n > 253402300799) return null;
  return new Date(n * 1000).toISOString();
}
export function parseOfpDetails(data) {
  const g = data.general ?? {}, t = data.times ?? {}, f = data.fuel ?? {}, w = data.weights ?? {};
  const event = key => ({ estimated: timestamp(t[`est_${key}`]), scheduled: timestamp(t[`sched_${key}`]) });
  const timing = {
    out: event('out'), off: event('off'), on: event('on'), in: event('in'),
    blockSeconds: positive(t.est_block), airborneSeconds: positive(t.est_time_enroute),
    taxiOutSeconds: positive(t.taxi_out), taxiInSeconds: positive(t.taxi_in),
    enduranceSeconds: positive(t.endurance), reserveSeconds: positive(t.reserve_time),
  };
  const fixes = Array.isArray(data.navlog?.fix) ? data.navlog.fix : data.navlog?.fix ? [data.navlog.fix] : [];
  const navlog = fixes.filter(fix => fix && text(fix.ident)).map(fix => {
    const elapsedSeconds = positive(fix.time_total);
    const eta = timing.off.estimated && elapsedSeconds !== null ? Date.parse(timing.off.estimated) / 1000 + elapsedSeconds : null;
    return {
      ident: text(fix.ident), name: text(fix.name), stage: text(fix.stage), airway: text(fix.via_airway),
      lat: coordinate(fix.pos_lat, 90), lon: coordinate(fix.pos_long, 180), altitude: positive(fix.altitude_feet),
      elapsedSeconds, eta: timestamp(eta), windDirection: direction(fix.wind_dir), windSpeed: positive(fix.wind_spd),
      temperature: ofpNumber(fix.oat), groundspeed: positive(fix.groundspeed), fuelRemaining: positive(fix.fuel_plan_onboard),
    };
  });
  return {
    airac: text(data.params?.airac), timing,
    procedures: {
      departure: { name: text(g.sid_ident), transition: text(g.sid_trans), runway: text(data.origin?.plan_rwy) },
      arrival: { name: text(g.star_ident), transition: text(g.star_trans), runway: text(data.destination?.plan_rwy) },
    },
    fuel: { block: positive(f.plan_ramp), takeoff: positive(f.plan_takeoff), minimumTakeoff: positive(f.min_takeoff),
      landing: positive(f.plan_landing), taxi: positive(f.taxi), trip: positive(f.enroute_burn), contingency: positive(f.contingency),
      contingencyRule: text(g.cont_rule), alternate: positive(f.alternate_burn), reserve: positive(f.reserve),
      extra: positive(f.extra), etops: positive(f.etops), averageFlow: positive(f.avg_fuel_flow) },
    cruise: { profile: text(g.cruise_profile), climb: text(g.climb_profile), descent: text(g.descent_profile),
      stepClimbs: text(g.stepclimb_string), mach: positive(g.cruise_mach),
      windDirection: direction(g.avg_wind_dir), windSpeed: positive(g.avg_wind_spd), windComponent: ofpNumber(g.avg_wind_comp),
      isaDeviation: ofpNumber(g.avg_temp_dev), tropopause: positive(g.avg_tropopause) },
    weights: { zeroFuel: positive(w.est_zfw), maxZeroFuel: positive(w.max_zfw), takeoff: positive(w.est_tow), maxTakeoff: positive(w.max_tow),
      landing: positive(w.est_ldw), maxLanding: positive(w.max_ldw), payload: positive(w.payload), cargo: positive(w.cargo) },
    navlog,
  };
}
export function formatSeconds(value) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const minutes = Math.floor(value / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
export function formatWind(direction, speed) {
  if (speed === 0) return 'Calm';
  if (direction == null || speed == null) return '—';
  return `${String(Math.round(direction)).padStart(3, '0')}° / ${speed} kt`;
}
export function formatWindComponent(value) {
  return value == null ? '—' : value === 0 ? 'Neutral' : `${Math.abs(value)} kt ${value < 0 ? 'headwind' : 'tailwind'}`;
}
