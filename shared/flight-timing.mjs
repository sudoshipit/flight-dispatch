const timestamp = value => {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const duration = (start, end) => {
  const a = timestamp(start), b = timestamp(end);
  return a == null || b == null || b < a ? null : (b - a) / 1000;
};
// Local planning changes are kept separate from the imported OFP and recorder.
export function validateTimingOverride(input) {
  if (input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter valid planned timings.');
  const out = input.offBlock;
  if (typeof out !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(out) ||
    timestamp(out) == null || new Date(out).toISOString() !== out || Number(out.slice(0, 4)) < 2000 || Number(out.slice(0, 4)) > 2100) {
    throw new Error('Enter a valid departure date and off-block time in UTC (2000–2100).');
  }
  const result = { offBlock: out };
  for (const [key, label, min, max] of [['taxiOutSeconds', 'Taxi-out', 0, 21600], ['airborneSeconds', 'Air time', 1, 172800], ['taxiInSeconds', 'Taxi-in', 0, 21600]]) {
    const value = input[key];
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) throw new Error(`${label} must be ${min ? 'greater than zero and ' : ''}no more than ${max / 60} minutes, or blank if unknown.`);
    result[key] = value;
  }
  return result;
}
export function plannedDeparture(plan) {
  return plan.timingOverride?.offBlock || plan.offBlock;
}
export function plannedTiming(plan) {
  const source = plan.ofp?.timing || {};
  const original = { ...source, out: source.out || { estimated: plan.offBlock || null, scheduled: null },
    off: source.off || { estimated: null, scheduled: null }, on: source.on || { estimated: null, scheduled: null }, in: source.in || { estimated: null, scheduled: null } };
  if (!plan.timingOverride) return original;
  const { offBlock, taxiOutSeconds, airborneSeconds, taxiInSeconds } = plan.timingOverride;
  const add = (start, seconds) => timestamp(start) == null || !Number.isFinite(seconds) ? null : new Date(timestamp(start) + seconds * 1000).toISOString();
  const off = add(offBlock, taxiOutSeconds), on = add(off, airborneSeconds), parked = add(on, taxiInSeconds);
  return { ...original, out: { ...original.out, estimated: offBlock }, off: { ...original.off, estimated: off },
    on: { ...original.on, estimated: on }, in: { ...original.in, estimated: parked },
    taxiOutSeconds, airborneSeconds, taxiInSeconds,
    blockSeconds: [taxiOutSeconds, airborneSeconds, taxiInSeconds].every(Number.isFinite) ? taxiOutSeconds + airborneSeconds + taxiInSeconds : null };
}
export function timingComparison(plan, now, tracking = false) {
  const actual = plan.actual || {}, planned = plannedTiming(plan);
  const events = [['out', 'Off blocks'], ['off', 'Takeoff'], ['on', 'Touchdown'], ['in', 'On block']].map(([key, label]) => {
    const target = plan.timingOverride ? planned[key]?.estimated : planned[key]?.estimated || planned[key]?.scheduled || (key === 'out' ? plan.offBlock : null);
    const observed = actual[key] || null, a = timestamp(observed), p = timestamp(target);
    return { key, label, planned: target, actual: observed, delta: a == null || p == null ? null : Math.floor(a / 1000) - Math.floor(p / 1000) };
  });
  const windows = [
    ['taxi-out', 'Taxi-out', 'out', 'off', 'taxiOutSeconds'],
    ['airborne', 'Air time', 'off', 'on', 'airborneSeconds'],
    ['taxi-in', 'Taxi-in', 'on', 'in', 'taxiInSeconds'],
    ['block', 'Total block', 'out', 'in', 'blockSeconds'],
  ].map(([key, label, from, to, plannedKey]) => {
    const start = actual[from], end = actual[to];
    const target = Number.isFinite(planned[plannedKey]) ? planned[plannedKey] :
      duration(events.find(e => e.key === from)?.planned, events.find(e => e.key === to)?.planned);
    const live = Boolean(tracking && start && !end && (key === 'block' || actual.phase === key));
    const current = live && Number.isFinite(now) ? new Date(now).toISOString() : actual.lastObservedAt;
    // A missing transition must not turn a completed/unknown window into a timer.
    const elapsed = duration(start, end || (key === 'block' || actual.phase === key ? current : null));
    const seconds = elapsed == null ? null : Math.floor(elapsed), plannedSeconds = target == null ? null : Math.floor(target);
    return { key, label, planned: plannedSeconds, actual: seconds, live,
      delta: seconds == null || plannedSeconds == null ? null : seconds - plannedSeconds };
  });
  return { events, windows };
}
export function offBlockCountdown(plan, now) {
  const actual = plan.actual || {};
  if (actual.out) return { state: 'departed', seconds: null, target: actual.out };
  if (['taxi-out', 'airborne', 'taxi-in', 'complete'].includes(actual.phase)) return { state: 'unobserved', seconds: null, target: null };
  const plannedTimes = plannedTiming(plan);
  const target = plannedTimes.out.estimated || plannedTimes.out.scheduled || plan.offBlock;
  const planned = timestamp(target);
  if (planned == null || !Number.isFinite(now)) return { state: 'unavailable', seconds: null, target: null };
  const remaining = planned - now;
  return { state: remaining < 0 ? 'overdue' : remaining <= 600000 ? 'soon' : 'countdown', seconds: Math.ceil(Math.abs(remaining) / 1000), target };
}
export function elapsedTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export function timingDelta(seconds, live = false) {
  if (!Number.isFinite(seconds)) return '—';
  if (Math.abs(seconds) < 1) return live ? 'At planned time' : 'On plan';
  const value = elapsedTime(Math.abs(seconds));
  return live ? `${value} ${seconds > 0 ? 'over' : 'remaining'}` : `${seconds > 0 ? '+' : '−'}${value}`;
}
