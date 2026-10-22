import test from 'node:test';
import assert from 'node:assert/strict';
import { LandingRecorder, distanceNm } from '../shared/landing.mjs';

export const sample = (ms, extra = {}) => ({
  at: Date.parse('2026-10-20T12:00:00Z') + ms, simTime: 1000 + ms / 1000,
  onGround: false, agl: 100, verticalSpeed: -240, groundspeed: 130,
  lat: 42.94, lon: -78.73, pitch: 3, bank: 1, parkingBrake: false,
  paused: false, replay: false, slew: false, running: true, simulator: 'Test simulator', ...extra,
});
export function airborne(recorder, start = 0) {
  for (let ms = start; ms <= start + 3000; ms += 100) recorder.ingest(sample(ms));
}
test('ground spawning and taxi do not create a landing; observed flight uses the last airborne sample', () => {
  const r = new LandingRecorder();
  for (let ms = 0; ms < 5000; ms += 100) r.ingest(sample(ms, { onGround: true, agl: 0 }));
  assert.equal(r.contacts.length, 0);
  airborne(r, 5000);
  r.ingest(sample(8050, { agl: 2, verticalSpeed: -183 }));
  assert.equal(r.ingest(sample(8100, { onGround: true, verticalSpeed: 0, agl: 0 })), true);
  assert.equal(r.contacts[0].rateFpm, -183);
  assert.equal(r.contacts[0].method, 'sampled-estimate');
  assert.equal(r.contacts[0].sampleAgeMs, 50);
  assert.equal(r.phase, 'landed');
});
test('MSFS touchdown velocity is converted from feet/second and can update one frame late', () => {
  const r = new LandingRecorder(); airborne(r);
  r.ingest(sample(3050, { onGround: true, touchdownVelocity: 3.5 }));
  assert.equal(r.contacts[0].rateFpm, -210); assert.equal(r.contacts[0].method, 'simulator-touchdown');
  const delayed = new LandingRecorder();
  for (let ms = 0; ms <= 3000; ms += 100) delayed.ingest(sample(ms, { touchdownVelocity: 9 }));
  delayed.ingest(sample(3050, { onGround: true, touchdownVelocity: 9 }));
  assert.equal(delayed.contacts[0].method, 'sampled-estimate');
  delayed.ingest(sample(3100, { onGround: true, touchdownVelocity: 2 }));
  assert.equal(delayed.contacts[0].rateFpm, -120);
  assert.equal(delayed.contacts.length, 1);
});
test('bounce contacts are retained and parking completes once, without duplicate landings', () => {
  const r = new LandingRecorder(); airborne(r);
  r.ingest(sample(3050, { onGround: true, agl: 0 }));
  r.ingest(sample(3100, { agl: 4, verticalSpeed: -100 }));
  r.ingest(sample(3150, { onGround: true, agl: 0 }));
  assert.equal(r.contacts.length, 2); assert.equal(r.contacts[1].bounce, true);
  for (let ms = 3200; ms <= 9000; ms += 100) r.ingest(sample(ms, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
  assert.equal(r.phase, 'complete'); assert.equal(r.contacts.length, 2);
  airborne(r, 10000); assert.equal(r.phase, 'complete');
});
test('go-around and subsequent sustained flight record another landing without labeling it a bounce', () => {
  const r = new LandingRecorder(); airborne(r);
  r.ingest(sample(3050, { onGround: true, agl: 0 }));
  airborne(r, 3100);
  r.ingest(sample(6150, { onGround: true, agl: 0 }));
  assert.equal(r.contacts.length, 2); assert.equal(r.contacts[1].bounce, false);
});
test('pause, replay, slew, menu, invalid data and gaps cannot turn an airborne sample into a false landing', () => {
  for (const invalid of [{ paused: true }, { replay: true }, { slew: true }, { running: false }, { lat: NaN }]) {
    const r = new LandingRecorder(); airborne(r);
    r.ingest(sample(3050, invalid)); r.ingest(sample(3100, { onGround: true }));
    assert.equal(r.contacts.length, 0, JSON.stringify(invalid));
  }
  for (const invalid of [{ at: sample(7000).at }, { simTime: 1 }, { lat: 50 }]) {
    const r = new LandingRecorder(); airborne(r);
    r.ingest(sample(3050, { ...invalid, onGround: true }));
    assert.equal(r.contacts.length, 0);
  }
});
test('disconnect during a bounce does not fabricate another contact after reconnect', () => {
  const r = new LandingRecorder(); airborne(r);
  r.ingest(sample(3050, { onGround: true, agl: 0 }));
  r.resetContinuity();
  r.ingest(sample(3100, { agl: 4 }));
  r.ingest(sample(3150, { onGround: true }));
  assert.equal(r.contacts.length, 1);
});
test('destination distance crosses the antimeridian and preserves missing coordinates', () => {
  assert.equal(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0);
  assert.ok(Math.abs(distanceNm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) - 120.08) < .1);
  assert.equal(distanceNm({ lat: null, lon: 0 }, { lat: 0, lon: 0 }), null);
});

test('parking detection recovers after a pause or disconnect following touchdown', () => {
  for (const interrupt of ['pause', 'disconnect', 'restart']) {
    let r = new LandingRecorder(); airborne(r);
    r.ingest(sample(3050, { onGround: true, agl: 0, groundspeed: 10 }));
    const touchdown = r.actual.on;
    for (let ms = 3100; ms <= 4000; ms += 100) r.ingest(sample(ms, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
    if (interrupt === 'pause') r.ingest(sample(4100, { paused: true }));
    else if (interrupt === 'disconnect') r.resetContinuity();
    else r = new LandingRecorder(r.actual, r.contacts);
    for (let ms = 5000; ms < 10000; ms += 100) r.ingest(sample(ms, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
    assert.equal(r.actual.in, null, interrupt);
    r.ingest(sample(10000, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
    assert.equal(r.phase, 'complete', interrupt);
    assert.equal(r.actual.in, new Date(sample(5000).at).toISOString(), interrupt);
    assert.equal(r.actual.on, touchdown);
    assert.equal(r.contacts.length, 1);
  }
});
