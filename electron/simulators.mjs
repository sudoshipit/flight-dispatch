import dgram from 'node:dgram';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SimConnectConnection, Protocol, SimConnectDataType, SimConnectPeriod, SimConnectConstants } from 'node-simconnect';
const require = createRequire(import.meta.url);
// Isolate the pinned package's discovery helper so rejection/cancellation is handled.
const { autodetectServerAddress } = require(path.join(path.dirname(require.resolve('node-simconnect')), 'connectionParameters.js'));

// Definition order must match the binary response order. All values are FLOAT64.
export const SIM_FIELDS = [
  ['onGround', 'SIM ON GROUND', 'Bool'],
  ['verticalSpeed', 'VERTICAL SPEED', 'feet per minute'],
  ['agl', 'PLANE ALT ABOVE GROUND', 'feet'],
  ['groundspeed', 'GROUND VELOCITY', 'knots'],
  ['pitch', 'PLANE PITCH DEGREES', 'degrees'],
  ['bank', 'PLANE BANK DEGREES', 'degrees'],
  ['lat', 'PLANE LATITUDE', 'degrees'],
  ['lon', 'PLANE LONGITUDE', 'degrees'],
  ['parkingBrake', 'BRAKE PARKING POSITION', 'Bool'],
  ['slew', 'IS SLEW ACTIVE', 'Bool'],
  ['simTime', 'ABSOLUTE TIME', 'seconds'],
];
export function connectSimConnect(onSample, onStatus, _port, createConnection = (...args) => new SimConnectConnection(...args), discover = autodetectServerAddress) {
  const handle = createConnection('Flight Dispatch landing recorder', Protocol.FSX_SP2);
  let closed = false, paused = true, running = false, fields = SIM_FIELDS, label = 'SimConnect';
  const close = () => { if (closed) return; closed = true; clearTimeout(timeout); handle.close(); };
  const fail = message => { if (!closed) { onStatus('disconnected', message); close(); } };
  const timeout = setTimeout(() => fail('SimConnect did not respond. Start your simulator and load a flight.'), 8000);
  handle.on('error', () => fail('SimConnect is unavailable. Start MSFS, FSX or Prepar3D and load a flight.'));
  handle.on('close', () => fail('Simulator connection closed. Reconnecting…'));
  handle.on('quit', () => fail('Simulator closed. Waiting for it to restart…'));
  handle.on('open', info => {
    if (closed) return;
    clearTimeout(timeout);
    label = info.applicationName || 'SimConnect';
    const modern = info.applicationVersionMajor >= 11 && !/Prepar3D|ESP/i.test(label);
    fields = modern ? [...SIM_FIELDS, ['touchdownVelocity', 'PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second']] : SIM_FIELDS;
    try {
      fields.forEach(([, name, unit]) => handle.addToDataDefinition(1, name, unit, SimConnectDataType.FLOAT64));
      handle.subscribeToSystemEvent(1, modern ? 'Pause_EX1' : 'Pause');
      handle.subscribeToSystemEvent(2, 'SimStart');
      handle.subscribeToSystemEvent(3, 'SimStop');
      handle.subscribeToSystemEvent(4, 'PositionChanged');
      handle.subscribeToSystemEvent(5, 'FlightLoaded');
      handle.requestSystemState(1, 'Sim');
      handle.requestDataOnSimObject(1, 1, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME);
      onStatus('connected', label);
    } catch { fail('Could not subscribe to simulator telemetry.'); }
  });
  handle.on('exception', () => fail('The simulator rejected a telemetry request. Check simulator compatibility and restart tracking.'));
  handle.on('systemState', event => { if (event.requestID === 1) running = event.dataInteger === 1; });
  handle.on('event', event => {
    if (event.clientEventId === 1) paused = event.data !== 0;
    if (event.clientEventId === 2) running = true;
    if (event.clientEventId === 3) running = false;
    if ([4, 5].includes(event.clientEventId) || paused || !running) onSample({ paused: true });
  });
  handle.on('eventFilename', () => onSample({ paused: true }));
  handle.on('simObjectData', data => {
    if (closed || data.requestID !== 1) return;
    try {
      const sample = Object.fromEntries(fields.map(([key]) => [key, data.data.readFloat64()]));
      onSample({ ...sample, at: Date.now(), simulator: label, onGround: sample.onGround !== 0, parkingBrake: sample.parkingBrake !== 0, slew: sample.slew !== 0, paused, running, replay: false });
    } catch { fail('Incomplete simulator telemetry received.'); }
  });
  // 4.2.1's connect() does not catch discovery rejection or cancellation.
  // Keep discovery bounded by our lifecycle; use its named-pipe transport on Windows.
  Promise.resolve().then(discover).then(address => {
    if (closed) return;
    if (address.type === 'pipe') handle._clientSocket.connect(address);
    else handle.connect({ host: address.host, port: address.port });
  }).catch(() => fail('SimConnect discovery failed. Check your SimConnect.cfg or start the simulator.'));
  return { close, get closed() { return closed; } };
}

// X-Plane's built-in RREF protocol works with both 11 and 12; no plugin needed.
export const XPLANE_FIELDS = [
  ['onGround', 'sim/flightmodel/failures/onground_any'],
  ['verticalSpeed', 'sim/flightmodel/position/local_vy'],
  ['agl', 'sim/flightmodel/position/y_agl'],
  ['groundspeed', 'sim/flightmodel/position/groundspeed'],
  ['pitch', 'sim/flightmodel/position/theta'],
  ['bank', 'sim/flightmodel/position/phi'],
  ['lat', 'sim/flightmodel/position/latitude'],
  ['lon', 'sim/flightmodel/position/longitude'],
  ['parkingBrake', 'sim/cockpit2/controls/parking_brake_ratio'],
  ['paused', 'sim/time/paused'],
  ['replay', 'sim/time/is_in_replay'],
  ['simTime', 'sim/time/total_flight_time_sec'],
];
export function rrefRequest(index, frequency = 20) {
  const buffer = Buffer.alloc(413);
  buffer.write('RREF\0'); buffer.writeInt32LE(frequency, 5); buffer.writeInt32LE(index, 9);
  buffer.write(XPLANE_FIELDS[index][1], 13, 400, 'ascii');
  return buffer;
}
export function decodeRref(buffer) {
  if (buffer.length < 13 || buffer.toString('ascii', 0, 4) !== 'RREF' || (buffer.length - 5) % 8) return [];
  const values = [];
  for (let offset = 5; offset < buffer.length; offset += 8) {
    const index = buffer.readInt32LE(offset), value = buffer.readFloatLE(offset + 4);
    if (index >= 0 && index < XPLANE_FIELDS.length && Number.isFinite(value)) values.push([index, value]);
  }
  return values;
}
export function connectXPlane(onSample, onStatus, port = 49000) {
  const socket = dgram.createSocket('udp4'), values = new Map();
  let closed = false, bound = false, connected = false, lastSample = 0;
  const sendSubscriptions = frequency => {
    if (!closed && bound) XPLANE_FIELDS.forEach((_, index) => socket.send(rrefRequest(index, frequency), port, '127.0.0.1', () => {}));
  };
  const close = () => {
    if (closed) return;
    closed = true; clearInterval(retry);
    const finish = () => { try { socket.close(); } catch { /* Binding may have failed. */ } };
    if (!bound) { finish(); return; }
    // Closing immediately discards queued UDP sends, leaving subscriptions active.
    let pending = XPLANE_FIELDS.length;
    const timeout = setTimeout(finish, 500);
    XPLANE_FIELDS.forEach((_, index) => socket.send(rrefRequest(index, 0), port, '127.0.0.1', () => {
      if (--pending === 0) { clearTimeout(timeout); finish(); }
    }));
  };
  const retry = setInterval(() => { if (Date.now() - lastSample > 2000) { connected = false; values.clear(); sendSubscriptions(20); onStatus('waiting', 'Waiting for X-Plane telemetry on this PC. Load a flight and check its UDP port.'); } }, 3000);
  socket.on('error', () => { onStatus('disconnected', 'X-Plane telemetry socket failed. Restart tracking.'); close(); });
  socket.on('message', (buffer, remote) => {
    if (closed || remote.address !== '127.0.0.1' || remote.port !== port) return;
    const at = Date.now();
    for (const [index, value] of decodeRref(buffer)) values.set(index, { value, at });
    // Datarefs may arrive in separate datagrams. Never combine stale frames.
    if (values.size !== XPLANE_FIELDS.length || [...values.values()].some(value => at - value.at > 100)) return;
    const sample = Object.fromEntries(XPLANE_FIELDS.map(([key], index) => [key, values.get(index).value]));
    values.clear(); lastSample = at;
    if (!connected) { connected = true; onStatus('connected', 'X-Plane 11 / 12'); }
    onSample({ ...sample, at, simulator: 'X-Plane', onGround: sample.onGround > .5, paused: sample.paused > .5, replay: sample.replay > .5,
      parkingBrake: sample.parkingBrake > .5, verticalSpeed: sample.verticalSpeed * 196.8503937, groundspeed: sample.groundspeed * 1.94384449, agl: sample.agl * 3.280839895, slew: false, running: true });
  });
  socket.bind(0, '127.0.0.1', () => { bound = true; sendSubscriptions(20); });
  return { close, get closed() { return closed; } };
}
