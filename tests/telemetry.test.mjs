import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { once, EventEmitter } from 'node:events';
import { Telemetry } from '../electron/telemetry.mjs';
import { Store } from '../electron/store.mjs';
import { connectSimConnect, connectXPlane, decodeRref, rrefRequest, XPLANE_FIELDS } from '../electron/simulators.mjs';

const sample = (ms, extra = {}) => ({ at: Date.parse('2026-10-20T12:00:00Z') + ms, simTime: ms / 1000,
  onGround: false, agl: 100, verticalSpeed: -180, groundspeed: 130, lat: 42.94, lon: -78.73, simulator: 'Test simulator', ...extra });
test('briefings automatically detect a live simulator, remain idempotent, and respect explicit stop', t => {
  const plans = new Map(['first', 'second', 'third'].map(id => [id, { id, callsign: id, destination: {} }]));
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: id => plans.get(id), savePlan: p => { plans.set(p.id, p); return p; } };
  const callbacks = {}, events = []; let starts = 0;
  const adapter = name => cb => { starts++; callbacks[name] = cb; return { close() {} }; };
  const tracker = new Telemetry(store, event => events.push(event), { simconnect: adapter('simconnect'), xplane: adapter('xplane') });
  t.after(() => tracker.stop(false));
  assert.equal(tracker.follow('first').planId, 'first'); assert.equal(starts, 2);
  tracker.follow('first'); assert.equal(starts, 2);
  tracker.follow('second'); assert.equal(tracker.status().planId, 'first');
  tracker.follow('second', { replaceWaiting: true }); assert.equal(tracker.status().planId, 'second');
  callbacks.simconnect(sample(0, { running: false }));
  callbacks.xplane(sample(0)); assert.equal(tracker.selected, 'xplane');
  tracker.follow('third', { replaceWaiting: true }); assert.equal(tracker.status().planId, 'second');
  for (let ms = 100; ms <= 3000; ms += 100) callbacks.xplane(sample(ms));
  callbacks.xplane(sample(3100, { onGround: true }));
  callbacks.xplane(sample(3200, { onGround: true, touchdownVelocity: 2 }));
  const contacts = events.filter(event => event.touchdownId);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].touchdownId, contacts[1].touchdownId);
  tracker.stop();
  tracker.follow('third'); tracker.stop();
  tracker.follow('third'); assert.equal(tracker.status().planId, null);
  tracker.start('third', { simulator: 'auto', xplanePort: 49000 });
  assert.equal(tracker.status().planId, 'third');
  tracker.stop();
  tracker.follow('second'); assert.equal(tracker.status().planId, null);
});
test('tracking locks to one simulator, saves contacts on the correct plan and preserves them during filing', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-telemetry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const plan = { id: 'fixture', callsign: 'SWA123', destination: { lat: 42.94, lon: -78.73 }, filing: { status: 'not-filed' } };
  store.savePlan(plan);
  const callbacks = {}, connections = {}, events = [];
  const adapter = name => (onSample, onStatus) => {
    callbacks[name] = onSample;
    onStatus('connected', name);
    return connections[name] = { closed: false, close() { this.closed = true; } };
  };
  const tracker = new Telemetry(store, state => events.push(state), { simconnect: adapter('simconnect'), xplane: adapter('xplane') });
  t.after(() => tracker.stop(false));
  assert.throws(() => tracker.start(plan.id, { simulator: 'other', xplanePort: 49000 }));
  assert.throws(() => tracker.start(plan.id, { simulator: 'auto', xplanePort: -1 }));
  tracker.start(plan.id, { simulator: 'auto', xplanePort: 49000 });
  assert.throws(() => tracker.start(plan.id, { simulator: 'auto', xplanePort: 49000 }), /Stop tracking/);
  for (let ms = 0; ms <= 3000; ms += 100) callbacks.xplane(sample(ms));
  assert.equal(connections.simconnect.closed, true);
  callbacks.simconnect(sample(3050, { onGround: true, touchdownVelocity: 20 }));
  assert.equal(store.getPlan(plan.id).landing, undefined);
  callbacks.xplane(sample(3050, { onGround: true, agl: 0 }));
  assert.equal(store.getPlan(plan.id).landing.contacts[0].rateFpm, -180);
  assert.equal(store.getPlan(plan.id).landing.contacts[0].destinationDistanceNm, 0);
  store.savePlan({ ...plan, filing: { status: 'filed' } });
  assert.equal(store.getPlan(plan.id).landing.contacts.length, 1);
  for (let ms = 3100; ms <= 8200; ms += 100) callbacks.xplane(sample(ms, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
  const saved = store.getPlan(plan.id);
  assert.ok(saved.landing.completedAt);
  assert.ok(saved.actual.on); assert.ok(saved.actual.in);
  assert.equal(saved.filing.status, 'filed');
  store.savePlan({ ...plan, landing: { ...saved.landing, contacts: [], completedAt: null } });
  assert.equal(store.getPlan(plan.id).landing.contacts.length, 1);
  assert.ok(store.getPlan(plan.id).landing.completedAt);
  assert.deepEqual(store.getPlan(plan.id).actual, saved.actual);
  assert.equal(tracker.status().planId, null);
  assert.equal(connections.xplane.closed, true);
  assert.ok(events.some(event => event.phase === 'complete' && event.plan?.landing.completedAt));
  assert.throws(() => tracker.start(plan.id, { simulator: 'auto', xplanePort: 49000 }), /already has landing/);
});

test('a new dispatch takes over a connected aircraft at the gate and records departure on that briefing', t => {
  const plans = new Map(['previous', 'fenix-a321'].map(id => [id, { id, callsign: id, destination: {} }]));
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: id => plans.get(id), savePlan: p => { plans.set(p.id, p); return p; } };
  let callback;
  const tracker = new Telemetry(store, () => {}, { simconnect: cb => { callback = cb; return { close() {} }; }, xplane: () => ({ close() {} }) });
  t.after(() => tracker.stop(false));
  tracker.follow('previous');
  callback(sample(0, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
  assert.equal(tracker.selected, 'simconnect');
  tracker.follow('fenix-a321'); // Browsing history must not change the active flight.
  assert.equal(tracker.status().planId, 'previous');
  const oldCallback = callback;
  tracker.follow('fenix-a321', { replaceWaiting: true });
  assert.equal(tracker.status().planId, 'fenix-a321');
  callback(sample(100, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
  for (let ms = 200; ms <= 3000; ms += 100) callback(sample(ms, { onGround: true, agl: 0, groundspeed: 6, parkingBrake: false }));
  oldCallback(sample(3100, { onGround: true, groundspeed: 100 }));
  assert.equal(plans.get('fenix-a321').actual.out, new Date(sample(200).at).toISOString());
  assert.equal(plans.get('fenix-a321').actual.phase, 'taxi-out');
  assert.equal(plans.get('previous').actual, undefined);
});

test('new imports cannot steal moving, paused, stale or already departed recordings', t => {
  for (const situation of ['moving', 'taxi-out', 'airborne', 'paused', 'stale']) {
    const plans = new Map(['current', 'next'].map(id => [id, { id, callsign: id, destination: {} }]));
    const store = { read: (_, fallback) => fallback, write() {}, getPlan: id => plans.get(id), savePlan: p => { plans.set(p.id, p); return p; } };
    let callback;
    const tracker = new Telemetry(store, () => {}, { simconnect: cb => { callback = cb; return { close() {} }; }, xplane: () => ({ close() {} }) });
    t.after(() => tracker.stop(false));
    tracker.follow('current');
    const ground = { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true };
    callback(sample(0, ground));
    if (situation === 'moving') callback(sample(100, { ...ground, groundspeed: 2, parkingBrake: false }));
    if (situation === 'taxi-out') {
      for (let ms = 100; ms <= 2500; ms += 100) callback(sample(ms, { ...ground, groundspeed: 6, parkingBrake: false }));
      callback(sample(2600, ground)); // A taxiway stop is not a new departure.
    }
    if (situation === 'airborne') callback(sample(100));
    if (situation === 'paused') callback(sample(100, { ...ground, paused: true }));
    if (situation === 'stale') tracker.lastReceived = Date.now() - 3000;
    tracker.follow('next', { replaceWaiting: true });
    assert.equal(tracker.status().planId, 'current', situation);
  }
});

test('explicit tracking switch saves the previous flight and validates the target before stopping', t => {
  const plans = new Map(['current', 'next', 'landed'].map(id => [id, { id, callsign: id, destination: {}, ...(id === 'landed' ? { landing: { contacts: [{}] } } : {}) }]));
  let callback, failSave = false;
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: id => {
    if (!plans.has(id)) throw Error('Missing plan'); return plans.get(id);
  }, savePlan: p => { if (failSave) throw Error('Disk unavailable'); plans.set(p.id, p); return p; } };
  const tracker = new Telemetry(store, () => {}, { simconnect: cb => { callback = cb; return { close() {} }; } });
  const config = { simulator: 'simconnect', xplanePort: 49000 };
  t.after(() => tracker.stop(false));
  tracker.start('current', config);
  callback(sample(0, { onGround: true, groundspeed: 0 }));
  for (let ms = 100; ms <= 2500; ms += 100) callback(sample(ms, { onGround: true, groundspeed: 10, parkingBrake: false }));
  assert.throws(() => tracker.switchTo('missing', config), /Missing plan/);
  assert.throws(() => tracker.switchTo('landed', config), /landing results/);
  assert.throws(() => tracker.switchTo('next', { simulator: 'invalid' }), /Choose a simulator/);
  failSave = true;
  assert.throws(() => tracker.switchTo('next', config), /Disk unavailable/);
  assert.equal(tracker.status().planId, 'current');
  failSave = false;
  const oldCallback = callback;
  tracker.switchTo('next', config);
  assert.equal(tracker.status().planId, 'next');
  assert.ok(plans.get('current').actual.out);
  assert.equal(plans.get('current').actual.lastObservedAt, new Date(sample(2500).at).toISOString());
  oldCallback(sample(2600, { onGround: true }));
  for (let ms = 2600; ms <= 6000; ms += 100) callback(sample(ms));
  assert.equal(plans.get('next').actual.phase, 'airborne');
  assert.equal(plans.get('next').actual.out, null);
  assert.equal(plans.get('next').actual.off, null);
});
test('stopped connections cannot record late samples and a failed save remains retryable', t => {
  let plan = { id: 'fixture', callsign: 'SWA123', destination: {} }, fail = false, callback;
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: () => plan, savePlan: p => { if (fail) throw Error('disk'); return plan = p; } };
  const tracker = new Telemetry(store, () => {}, { xplane: cb => { callback = cb; return { close() {} }; } });
  t.after(() => tracker.stop(false));
  tracker.start('fixture', { simulator: 'xplane', xplanePort: 49000 });
  for (let ms = 0; ms <= 3000; ms += 100) callback(sample(ms));
  fail = true; callback(sample(3050, { onGround: true }));
  assert.equal(tracker.status().status, 'error');
  assert.throws(() => tracker.stop(), /disk/);
  assert.equal(tracker.status().planId, 'fixture');
  fail = false; tracker.stop();
  assert.equal(plan.landing.contacts.length, 1);
  callback(sample(3100, { onGround: true }));
  assert.equal(plan.landing.contacts.length, 1);
});

test('periodic checkpoints and shutdown preserve progress without completing an unfinished landing', t => {
  let now = Date.parse('2026-10-20T12:00:00Z'), callback, saves = 0;
  let plan = { id: 'fixture', callsign: 'SWA123', destination: {} };
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: () => plan, savePlan: p => { saves++; return plan = p; } };
  const adapters = { simconnect: cb => { callback = cb; return { close() {} }; }, xplane: () => ({ close() {} }) };
  const events = [];
  let tracker = new Telemetry(store, value => events.push(value), adapters, () => now);
  t.after(() => tracker.stop(false));
  tracker.follow('fixture');
  for (let ms = 0; ms <= 100000; ms += 100) { now = sample(ms).at; callback(sample(ms)); }
  assert.equal(saves, 4); // Initial airborne event, then at 33, 63 and 93 seconds.
  assert.equal(plan.actual.lastObservedAt, new Date(sample(93000).at).toISOString());
  now = sample(100100).at; callback(sample(100100, { onGround: true, agl: 0, groundspeed: 10 }));
  const touchdown = plan.actual.on, startedAt = plan.landing.startedAt;
  now = sample(101000).at; callback(sample(101000, { onGround: true, agl: 0, groundspeed: 10 }));
  tracker.shutdown();
  assert.equal(plan.actual.lastObservedAt, new Date(now).toISOString());
  assert.equal(plan.landing.completedAt, null);
  assert.equal(plan.actual.in, null);
  events.length = 0;
  tracker = new Telemetry(store, value => events.push(value), adapters, () => now);
  tracker.follow('fixture');
  assert.equal(tracker.status().planId, 'fixture');
  for (let ms = 110000; ms <= 115000; ms += 100) {
    now = sample(ms).at;
    callback(sample(ms, { onGround: true, agl: 0, groundspeed: 0, parkingBrake: true }));
  }
  assert.equal(plan.actual.on, touchdown);
  assert.equal(plan.actual.in, new Date(sample(110000).at).toISOString());
  assert.equal(plan.landing.startedAt, startedAt);
  assert.equal(plan.landing.contacts.length, 1);
  assert.ok(plan.landing.completedAt);
  assert.equal(events.filter(event => event.touchdownId).length, 0, 'Resuming/parking must not replay the touchdown popup');
  tracker.follow('fixture');
  assert.equal(tracker.status().planId, null);
});

test('failed checkpoints retry and invalid samples do not replace the last valid telemetry readout', t => {
  let now = sample(0).at, callback, failSave = true;
  let plan = { id: 'fixture', callsign: 'SWA123', destination: {} };
  const store = { read: (_, fallback) => fallback, write() {}, getPlan: () => plan, savePlan: p => { if (failSave) throw Error('Disk'); return plan = p; } };
  const tracker = new Telemetry(store, () => {}, { simconnect: cb => { callback = cb; return { close() {} }; } }, () => now);
  t.after(() => tracker.stop(false));
  tracker.start('fixture', { simulator: 'simconnect', xplanePort: 49000 });
  for (let ms = 0; ms <= 3000; ms += 100) { now = sample(ms).at; callback(sample(ms)); }
  assert.equal(tracker.status().status, 'error');
  failSave = false;
  for (let ms = 3100; ms <= 8000; ms += 100) { now = sample(ms).at; callback(sample(ms)); }
  assert.equal(tracker.status().status, 'tracking');
  assert.equal(plan.actual.phase, 'airborne');
  const valid = tracker.status().sample;
  assert.equal(valid.groundspeed, 130); assert.equal(valid.parkingBrake, null);
  callback(sample(8100, { lat: NaN }));
  assert.equal(tracker.status().status, 'waiting');
  assert.deepEqual(tracker.status().sample, valid);
});
test('X-Plane request layout, response validation and actual localhost UDP conversion', async t => {
  const request = rrefRequest(0);
  assert.equal(request.length, 413); assert.equal(request.readInt32LE(5), 20); assert.equal(request.readInt32LE(9), 0);
  assert.equal(request.toString('ascii', 13).replace(/\0/g, ''), XPLANE_FIELDS[0][1]);
  assert.deepEqual(decodeRref(Buffer.from('BAD!')), []);
  assert.deepEqual(decodeRref(Buffer.alloc(14)), []);
  const server = dgram.createSocket('udp4');
  server.bind(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => server.close());
  const incoming = new Set(), stopped = new Set();
  server.on('message', (message, remote) => {
    const index = message.readInt32LE(9);
    if (message.readInt32LE(5) === 0) { stopped.add(index); return; }
    incoming.add(index);
    if (incoming.size !== XPLANE_FIELDS.length) return;
    const response = Buffer.alloc(5 + XPLANE_FIELDS.length * 8); response.write('RREF,');
    const raw = { onGround: 0, verticalSpeed: -1, agl: 30, groundspeed: 50, pitch: 3, bank: 2, lat: 42, lon: -78, parkingBrake: 0, paused: 0, replay: 0, simTime: 100 };
    XPLANE_FIELDS.forEach(([key], i) => { response.writeInt32LE(i, 5 + i * 8); response.writeFloatLE(raw[key], 9 + i * 8); });
    server.send(response, remote.port, remote.address);
  });
  let connector;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Local UDP fixture timed out')), 3000);
    connector = connectXPlane(s => { clearTimeout(timer); resolve(s); }, () => {}, server.address().port);
    t.after(() => { clearTimeout(timer); connector.close(); });
  });
  assert.ok(Math.abs(result.verticalSpeed + 196.8504) < .001);
  assert.ok(Math.abs(result.groundspeed - 97.1922) < .001);
  assert.equal(result.onGround, false); assert.equal(result.replay, false);
  connector.close();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(stopped.size, XPLANE_FIELDS.length);
});

test('SimConnect decodes ordered doubles, handles pause, and does not connect after cancellation', async t => {
  class FakeConnection extends EventEmitter {
    definitions = []; subscriptions = []; connected = false; closed = false;
    connect() { this.connected = true; }
    close() { this.closed = true; }
    addToDataDefinition(_, name, unit) { this.definitions.push([name, unit]); }
    subscribeToSystemEvent(id, name) { this.subscriptions.push([id, name]); }
    requestSystemState() {}
    requestDataOnSimObject() {}
  }
  const handle = new FakeConnection(), samples = [], statuses = [];
  const connector = connectSimConnect(s => samples.push(s), (...s) => statuses.push(s), null, () => handle, async () => ({ type: 'ipv4', host: '127.0.0.1', port: 1234 }));
  t.after(() => connector.close());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handle.connected, true);
  handle.emit('open', { applicationName: 'MSFS', applicationVersionMajor: 11 });
  assert.ok(handle.subscriptions.some(([, name]) => name === 'Pause_EX1'));
  assert.equal(handle.definitions.at(-1)[0], 'PLANE TOUCHDOWN NORMAL VELOCITY');
  handle.emit('systemState', { requestID: 1, dataInteger: 1 });
  handle.emit('event', { clientEventId: 1, data: 0 });
  const send = () => {
    const raw = [0, -240, 100, 130, 3, 1, 42, -78, 0, 0, 1000, 4];
    handle.emit('simObjectData', { requestID: 1, data: { readFloat64: () => raw.shift() } });
  };
  send(); assert.equal(samples.at(-1).verticalSpeed, -240); assert.equal(samples.at(-1).touchdownVelocity, 4);
  assert.equal(samples.at(-1).onGround, false); assert.equal(samples.at(-1).paused, false);
  handle.emit('event', { clientEventId: 1, data: 4 }); send();
  assert.equal(samples.at(-1).paused, true);
  handle.emit('exception', {}); assert.equal(connector.closed, true);
  assert.equal(statuses.at(-1)[0], 'disconnected');
  const cancelled = new FakeConnection();
  const late = connectSimConnect(() => {}, () => {}, null, () => cancelled, async () => ({ type: 'ipv4', host: '127.0.0.1', port: 1234 }));
  late.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled.connected, false);
  const broken = new FakeConnection(), errors = [];
  const failed = connectSimConnect(() => {}, (_, message) => errors.push(message), null, () => broken, async () => { throw Error('invalid config'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failed.closed, true); assert.match(errors[0], /discovery failed/);
});
