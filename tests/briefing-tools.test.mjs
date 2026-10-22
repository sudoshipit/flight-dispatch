import test from 'node:test';
import assert from 'node:assert/strict';
import { briefingText, flightReportText, flightHistoryView, userMessage } from '../shared/briefing-tools.mjs';
import { parseOFP } from '../shared/domain.mjs';
import { ofp } from './fixtures.mjs';

test('history search combines words and UTC filters do not mislabel a flight joined midair', () => {
  const base = parseOFP(ofp), now = Date.parse('2026-12-31T23:50:00Z');
  const later = { ...base, id: 'later', offBlock: '2027-01-01T00:10:00Z' };
  const earlier = { ...base, id: 'earlier', offBlock: '2026-12-31T23:55:00Z' };
  const airborne = { ...later, id: 'airborne', actual: { phase: 'airborne', out: null } };
  const complete = { ...later, id: 'complete', landing: { completedAt: '2026-12-31T23:49:00Z' } };
  const flights = [later, earlier, airborne, complete];
  assert.deepEqual(flightHistoryView(flights, { search: 'swa tampa B737', filter: 'upcoming', sort: 'departure', now }).map(p => p.id), ['earlier','later']);
  assert.deepEqual(flightHistoryView(flights, { filter: 'complete' }).map(p => p.id), ['complete']);
  assert.deepEqual(flightHistoryView(flights, { filter: 'in-progress' }).map(p => p.id), ['airborne']);
  assert.equal(flightHistoryView(flights, { search: 'nonexistent' }).length, 0);
  assert.equal(flights[0].id, 'later');
});

test('flight reports preserve observed UTC times, missing milestones and landing measurement provenance', () => {
  const plan = { ...parseOFP(ofp), actual: { out: null, off: null, on: '2026-10-19T16:40:00Z', in: null,
    phase: 'taxi-in', lastObservedAt: '2026-10-19T16:42:00Z' }, landing: { simulator: 'Fixture sim', contacts: [
      { time: '2026-10-19T16:40:00Z', rateFpm: 0, method: 'simulator-touchdown', bounce: false },
      { time: '2026-10-19T16:40:01Z', rateFpm: -120, method: 'sampled-estimate', bounce: true },
    ] } };
  const text = flightReportText(plan, Date.parse('2026-10-19T16:43:00Z'), true);
  assert.match(text, /Off blocks: Not observed/);
  assert.match(text, /Takeoff: Not observed/);
  assert.match(text, /Taxi-in: 00:03:00 \(elapsed so far\)/);
  assert.match(text, /0 ft\/min · simulator measurement/);
  assert.match(text, /-120 ft\/min · sampled estimate · bounce/);
  assert.ok(!text.includes('undefined'));
  const stopped = flightReportText(plan, Date.parse('2026-10-19T20:00:00Z'), false);
  assert.match(stopped, /Taxi-in: 00:02:00 \|/);
  assert.ok(!stopped.includes('elapsed so far'));
});
test('history attention filter distinguishes failed and unconfirmed filings from unfiled plans', () => {
  const base = parseOFP(ofp);
  const flights = ['filed','not-filed','failed','pending','unconfirmed'].map(status => ({ ...base, filing: { status } }));
  assert.deepEqual(flightHistoryView(flights, { filter: 'attention' }).map(p => p.filing.status), ['failed','unconfirmed']);
});
test('copied briefing preserves zero values, fuel units, UTC dates and historical gate provenance', () => {
  const plan = { ...parseOFP(ofp), costIndex: 0, passengers: 0, blockFuel: 0, alternate: '' };
  const details = { airports: { KBUF: { elevation: 0, frequencies: [] } }, gates: { departure: { value: 'C30', source: 'Saved provider', historical: true, date: '2026-10-18T12:00:00Z' } } };
  const text = briefingText(plan, details);
  assert.match(text, /CI 0 · passengers 0/);
  assert.match(text, /Planned fuel \(LBS\): block 0/);
  assert.match(text, /Alternate None · destination elevation 0 ft MSL/);
  assert.match(text, /historical suggestion · Saved provider · flight 2026-10-18 12:00:00Z/);
  assert.match(text, /METAR \(SimBrief snapshot, observed /);
  assert.match(text, /Planned off blocks 2026-10-19 14:15:00Z/);
  assert.match(text, /SID BAYPO2/);
  assert.ok(!text.includes('undefined'));
});
test('service errors keep the actionable message without remote invocation and browser stacks', () => {
  assert.equal(userMessage(new Error("Error invoking remote method 'dispatch:simbrief-flights': Error: page.evaluate: Error: Refresh the flight list.\n    at readSimbriefFlights (eval at evaluate)")), 'Refresh the flight list.');
  assert.equal(userMessage('Could not reach SimBrief. Check your connection.'), 'Could not reach SimBrief. Check your connection.');
  assert.match(userMessage(null), /try again/);
});
