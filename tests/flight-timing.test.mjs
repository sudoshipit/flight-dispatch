import test from 'node:test';
import assert from 'node:assert/strict';
import { LandingRecorder } from '../shared/landing.mjs';
import { elapsedTime, offBlockCountdown, timingComparison, timingDelta } from '../shared/flight-timing.mjs';

const base = Date.parse('2026-12-31T23:59:50Z');
const sample = (ms, extra = {}) => ({ at: base + ms, simTime: ms / 1000, onGround: true,
  agl: 0, verticalSpeed: -180, groundspeed: 0, parkingBrake: true, lat: 42, lon: -78, ...extra });
const iso = ms => new Date(base + ms).toISOString();
test('off-block countdown ticks across midnight, reports overdue, and stops on observed departure', () => {
  const plan = { offBlock: iso(30000) };
  assert.equal(offBlockCountdown(plan, base).seconds, 30);
  assert.equal(offBlockCountdown(plan, base + 1000).seconds, 29);
  assert.equal(offBlockCountdown(plan, base + 30000).seconds, 0);
  assert.deepEqual(offBlockCountdown(plan, base + 31000), { state: 'overdue', seconds: 1, target: plan.offBlock });
  assert.equal(offBlockCountdown({ ...plan, actual: { out: iso(31000) } }, base + 40000).state, 'departed');
  assert.equal(offBlockCountdown({ ...plan, actual: { phase: 'airborne' } }, base + 40000).state, 'unobserved');
  assert.equal(offBlockCountdown({}, base).state, 'unavailable');
});
const taxi = recorder => {
  recorder.ingest(sample(0));
  for (let ms = 100; ms <= 5000; ms += 100) recorder.ingest(sample(ms, { groundspeed: 8, parkingBrake: false }));
};
test('actual timings observe departure, flight and parking, including UTC year rollover', () => {
  const r = new LandingRecorder(); taxi(r);
  assert.equal(r.actual.out, iso(100));
  for (let ms = 5100; ms <= 12000; ms += 100) r.ingest(sample(ms, { onGround: false, agl: 100, groundspeed: 130, parkingBrake: false }));
  assert.equal(r.actual.off, iso(5100)); assert.equal(r.actual.phase, 'airborne');
  r.ingest(sample(12100, { groundspeed: 120, parkingBrake: false }));
  assert.equal(r.actual.on, iso(12100)); assert.equal(r.actual.phase, 'taxi-in');
  for (let ms = 12200; ms <= 17500; ms += 100) r.ingest(sample(ms));
  assert.equal(r.actual.in, iso(12200)); assert.equal(r.actual.phase, 'complete');
  assert.match(r.actual.on, /^2027-01-01/);
});
test('jitter, brake release alone and taxiing on first connection do not invent off-block time', () => {
  const r = new LandingRecorder();
  r.ingest(sample(0));
  r.ingest(sample(100, { groundspeed: 2, parkingBrake: false }));
  r.ingest(sample(500, { groundspeed: 0, parkingBrake: false }));
  assert.equal(r.actual.out, null);
  const late = new LandingRecorder();
  for (let ms = 0; ms <= 5000; ms += 100) late.ingest(sample(ms, { groundspeed: 20, parkingBrake: false }));
  late.ingest(sample(5100, { groundspeed: 0, parkingBrake: false }));
  for (let ms = 5200; ms <= 9000; ms += 100) late.ingest(sample(ms, { groundspeed: 20, parkingBrake: false }));
  assert.equal(late.actual.out, null);
});
test('midair connection, data gaps, pauses and slew do not create missing departure events', () => {
  for (const interrupt of [{ paused: true }, { slew: true }, { replay: true }, { running: false }]) {
    const r = new LandingRecorder(); taxi(r);
    r.ingest(sample(5100, interrupt));
    for (let ms = 5200; ms <= 8500; ms += 100) r.ingest(sample(ms, { onGround: false, agl: 100 }));
    assert.equal(r.actual.off, null);
    assert.equal(r.actual.phase, 'airborne');
  }
  const gap = new LandingRecorder(); taxi(gap);
  for (let ms = 8000; ms <= 12000; ms += 100) gap.ingest(sample(ms, { onGround: false, agl: 100 }));
  assert.equal(gap.actual.off, null);
});
test('a bounce preserves touchdown timing; a subsequent circuit replaces it on final landing', () => {
  const r = new LandingRecorder(); taxi(r);
  for (let ms = 5100; ms <= 8200; ms += 100) r.ingest(sample(ms, { onGround: false, agl: 100 }));
  r.ingest(sample(8300, { groundspeed: 100, parkingBrake: false }));
  r.ingest(sample(8400, { onGround: false, agl: 4 }));
  r.ingest(sample(8500, { groundspeed: 100, parkingBrake: false }));
  assert.equal(r.actual.on, iso(8300));
  for (let ms = 8600; ms <= 12000; ms += 100) r.ingest(sample(ms, { onGround: false, agl: 100 }));
  assert.equal(r.actual.on, null);
  assert.equal(r.actual.off, iso(5100));
  r.ingest(sample(12100, { groundspeed: 100, parkingBrake: false }));
  assert.equal(r.actual.on, iso(12100));
});
test('plan comparisons use full UTC dates and live timers stop at observed transitions', () => {
  const plan = { offBlock: iso(0), actual: { out: iso(1000), off: iso(7000), on: null, in: null, phase: 'airborne', lastObservedAt: iso(10000) },
    ofp: { timing: { out: { estimated: iso(0) }, off: { estimated: iso(5000) }, on: { estimated: iso(14000) },
      in: { estimated: iso(16000) }, taxiOutSeconds: 5, airborneSeconds: 9, taxiInSeconds: 2, blockSeconds: 16 } } };
  const { events, windows } = timingComparison(plan, base + 12000, true);
  assert.equal(events[0].delta, 1); assert.equal(events[1].delta, 2);
  assert.equal(windows[0].actual, 6); assert.equal(windows[0].live, false);
  assert.equal(windows[1].actual, 5); assert.equal(windows[1].delta, -4); assert.equal(windows[1].live, true);
  assert.equal(windows[2].actual, null); assert.equal(windows[3].actual, 11);
  const stopped = timingComparison(plan, base + 60000, false);
  assert.equal(stopped.windows[1].actual, 3);
  assert.equal(timingDelta(-4, true), '00:00:04 remaining');
  assert.equal(timingDelta(2), '+00:00:02'); assert.equal(elapsedTime(3661), '01:01:01');
  assert.equal(timingComparison({}, base, true).windows[0].actual, null);
  const fractional = timingComparison({ ...plan, actual: { ...plan.actual, off: iso(7100) } }, base + 12000, true);
  assert.equal(fractional.events[1].delta, 2);
  assert.equal(fractional.windows[0].actual, 6); assert.equal(fractional.windows[0].delta, 1);
});
