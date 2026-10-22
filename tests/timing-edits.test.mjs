import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store.mjs';
import { parseOFP, vatsimFields } from '../shared/domain.mjs';
import { plannedTiming, plannedDeparture, validateTimingOverride, offBlockCountdown, timingComparison } from '../shared/flight-timing.mjs';
import { briefingText, flightReportText, flightHistoryView } from '../shared/briefing-tools.mjs';
import { ofp } from './fixtures.mjs';

const edit = { offBlock: '2026-12-31T23:55:00.000Z', taxiOutSeconds: 600, airborneSeconds: 7200, taxiInSeconds: 300 };
test('local timings roll over the UTC year and update countdowns, durations, history and reports', () => {
  const original = parseOFP(ofp), snapshot = structuredClone(original);
  const plan = { ...original, timingOverride: validateTimingOverride(edit) };
  const timing = plannedTiming(plan);
  assert.equal(timing.off.estimated, '2027-01-01T00:05:00.000Z');
  assert.equal(timing.on.estimated, '2027-01-01T02:05:00.000Z');
  assert.equal(timing.in.estimated, '2027-01-01T02:10:00.000Z');
  assert.equal(timing.blockSeconds, 8100);
  assert.equal(timing.out.scheduled, original.ofp.timing.out.scheduled);
  assert.equal(plannedDeparture(plan), edit.offBlock);
  const now = Date.parse('2026-12-31T23:50:00Z');
  assert.deepEqual(offBlockCountdown(plan, now), { state: 'soon', seconds: 300, target: edit.offBlock });
  const observed = { ...plan, actual: { out: '2026-12-31T23:56:00Z', off: '2027-01-01T00:08:00Z', phase: 'airborne' } };
  const comparison = timingComparison(observed, Date.parse('2027-01-01T00:10:00Z'), true);
  assert.equal(comparison.events[0].delta, 60);
  assert.equal(comparison.events[1].delta, 180);
  assert.equal(comparison.windows[0].delta, 120);
  assert.equal(comparison.windows[1].planned, 7200);
  assert.match(briefingText(plan), /Planned on block 2027-01-01 02:10:00Z/);
  assert.match(flightReportText(observed, now), /planned 2026-12-31 23:55:00Z/);
  assert.deepEqual(flightHistoryView([original, plan], { filter: 'upcoming', now }), [plan]);
  assert.deepEqual(flightHistoryView([plan, original], { sort: 'departure' }), [original, plan]);
  assert.deepEqual(vatsimFields(plan), vatsimFields(original));
  assert.deepEqual(original, snapshot);
});

test('unknown timing durations do not invent milestones or fall back to an unrelated scheduled arrival', () => {
  const plan = { ...parseOFP(ofp), timingOverride: { ...edit, taxiOutSeconds: 0, airborneSeconds: null } };
  plan.ofp.timing.on.scheduled = '2026-10-19T16:50:00Z';
  const timing = plannedTiming(plan);
  assert.equal(timing.off.estimated, edit.offBlock);
  assert.equal(timing.on.estimated, null);
  assert.equal(timing.in.estimated, null);
  assert.equal(timing.blockSeconds, null);
  assert.equal(timingComparison(plan, Date.now()).events[2].planned, null);
  assert.equal(timingComparison(plan, Date.now()).windows[1].planned, null);
  assert.match(briefingText(plan), /Planned on block None/);
});

test('timing edits validate UTC dates and duration bounds at the storage boundary', () => {
  assert.deepEqual(validateTimingOverride({ ...edit, arbitrary: 'discard' }), edit);
  assert.equal(validateTimingOverride(null), null);
  for (const offBlock of ['2026-02-30T12:00:00.000Z', '2026-12-31T25:00:00.000Z', '2026-01-01T12:00:00', '2026-01-01T12:00:00-05:00', '', null]) {
    assert.throws(() => validateTimingOverride({ ...edit, offBlock }), /valid departure/);
  }
  assert.equal(validateTimingOverride({ ...edit, offBlock: '2028-02-29T00:00:00.000Z' }).offBlock, '2028-02-29T00:00:00.000Z');
  for (const [key, value] of [['taxiOutSeconds', -1], ['taxiInSeconds', 21601], ['airborneSeconds', 0], ['airborneSeconds', 172801], ['airborneSeconds', '600'], ['taxiInSeconds', NaN], ['taxiOutSeconds', 2.5], ['taxiOutSeconds', undefined]]) {
    assert.throws(() => validateTimingOverride({ ...edit, [key]: value }), /minutes/);
  }
});

test('timing edits survive reloads, reimports and recorder saves; resetting cannot be undone by stale saves', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-timings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory), base = parseOFP(ofp);
  const actual = { out: '2026-10-19T14:16:00Z', phase: 'taxi-out' }, landing = { contacts: [{ rateFpm: -100 }] };
  store.savePlan({ ...base, actual, landing });
  const saved = store.saveTimings(base.id, edit);
  assert.deepEqual(saved.actual, actual);
  assert.deepEqual(saved.landing, landing);
  assert.deepEqual(saved.ofp, base.ofp);
  assert.deepEqual(saved.filing, base.filing);
  assert.deepEqual(new Store(directory).getPlan(base.id).timingOverride, edit);
  assert.deepEqual(store.savePlan(base).timingOverride, edit);
  assert.deepEqual(store.savePlan({ ...base, actual }, { updateActual: true }).timingOverride, edit);
  assert.throws(() => store.saveTimings(base.id, { ...edit, taxiInSeconds: -1 }));
  assert.deepEqual(store.getPlan(base.id).timingOverride, edit);
  store.saveTimings(base.id, null);
  const reset = store.savePlan(saved);
  assert.equal(reset.timingOverride, null);
  assert.deepEqual(plannedTiming(reset), plannedTiming(base));
  assert.deepEqual(reset.actual, actual);
  assert.equal(store.savePlan({ ...base, id: 'another-flight' }).timingOverride, undefined);
});
