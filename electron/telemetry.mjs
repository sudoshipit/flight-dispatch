import { LandingRecorder, distanceNm } from '../shared/landing.mjs';
import { connectSimConnect, connectXPlane } from './simulators.mjs';

export class Telemetry {
  constructor(store, emit, adapters = { simconnect: connectSimConnect, xplane: connectXPlane }) {
    this.store = store; this.emit = emit; this.adapters = adapters; this.connections = {};
    this.state = { status: 'idle', message: 'Start tracking before takeoff to record your landing.', planId: null, callsign: '', simulator: '', phase: 'waiting' };
  }
  status() { return { ...this.state, config: this.store.read('telemetry-settings', { simulator: 'auto', xplanePort: 49000 }) }; }
  start(id, config = {}) {
    if (this.state.planId) throw new Error(`Stop tracking ${this.state.callsign} before starting another flight.`);
    if (!['auto', 'simconnect', 'xplane'].includes(config.simulator) || !Number.isInteger(config.xplanePort) || config.xplanePort < 1024 || config.xplanePort > 65535) throw new Error('Choose a simulator and a valid X-Plane UDP port (1024–65535).');
    const plan = this.store.getPlan(String(id));
    if (plan.landing?.contacts.length) throw new Error('This flight already has landing results. Generate or import a new flight to record another session.');
    this.store.write('telemetry-settings', config);
    this.recorder = new LandingRecorder(); this.startedAt = new Date().toISOString(); this.plan = plan;
    this.selected = null; this.lastReceived = 0; this.lastEmit = 0; this.saveError = false;
    const generation = this.generation = (this.generation || 0) + 1;
    this.state = { status: 'waiting', message: 'Looking for your simulator. Load a flight; tracking starts automatically.', planId: plan.id, callsign: plan.callsign, simulator: '', phase: 'waiting' };
    this.emit(this.status());
    const connect = () => {
      for (const name of config.simulator === 'auto' ? ['simconnect', 'xplane'] : [config.simulator]) {
        if (this.selected && this.selected !== name || this.connections[name] && !this.connections[name].closed) continue;
        this.connections[name] = this.adapters[name](
          sample => {
            if (this.generation !== generation) return;
            if (!Number.isFinite(sample.at)) { if (this.selected === name) this.recorder.resetContinuity(); return; }
            if (!this.selected) {
              this.selected = name;
              for (const [other, connection] of Object.entries(this.connections)) if (other !== name) connection.close();
            }
            if (this.selected !== name) return;
            this.receive(sample);
          },
          (status, message) => {
            if (this.generation !== generation || this.selected && this.selected !== name) return;
            if (status !== 'connected') {
              if (this.selected === name) this.recorder.resetContinuity();
              this.state.status = 'waiting'; this.state.message = config.simulator === 'auto' && !this.selected ? 'Waiting for MSFS / SimConnect or X-Plane. Load a flight on this PC.' : message;
              this.emit(this.status());
            }
          }, config.xplanePort);
      }
    };
    connect();
    this.timer = setInterval(() => {
      if (this.lastReceived && Date.now() - this.lastReceived > 3000) {
        this.recorder.resetContinuity(); this.state.status = 'waiting';
        this.state.message = 'Telemetry paused or disconnected. No landing is inferred across a data gap.';
        this.emit(this.status());
      }
      connect();
    }, 4000);
    return this.status();
  }
  receive(sample) {
    this.lastReceived = Date.now();
    const changed = this.recorder.ingest(sample);
    this.state.simulator = sample.simulator;
    this.state.phase = this.recorder.phase;
    this.state.status = sample.paused || sample.replay || sample.slew || sample.running === false ? 'paused' : 'tracking';
    this.state.message = this.state.status === 'paused' ? 'Simulator paused, loading or in replay. Recording suspended.' :
      this.recorder.phase === 'airborne' ? 'Airborne. Recording touchdown automatically.' :
      this.recorder.phase === 'landed' ? 'Touchdown recorded. Park and set the parking brake, or finish tracking.' :
      this.recorder.phase === 'complete' ? 'Flight complete. Landing results saved.' : 'Connected. Waiting for sustained flight before recording a landing.';
    let plan;
    if (changed) {
      try { plan = this.save(this.recorder.phase === 'complete'); this.saveError = false; }
      catch { this.saveError = true; }
    }
    if (this.saveError) { this.state.message = 'Landing detected, but saving failed. Keep the app open and try Finish tracking again.'; this.state.status = 'error'; }
    if (changed || Date.now() - this.lastEmit > 500) { this.lastEmit = Date.now(); this.emit({ ...this.status(), plan }); }
    if (this.recorder.phase === 'complete' && plan) this.stop(false);
  }
  save(complete) {
    const plan = this.store.getPlan(this.state.planId);
    const landing = { startedAt: this.startedAt, completedAt: complete ? new Date().toISOString() : null, simulator: this.state.simulator,
      contacts: this.recorder.contacts.map(contact => ({ ...contact, destinationDistanceNm: distanceNm(contact, this.plan.destination) })) };
    return this.store.savePlan({ ...plan, landing }, { updateLanding: true });
  }
  stop(finish = true) {
    let plan;
    if (finish && this.recorder?.contacts.length && this.state.planId) plan = this.save(true);
    this.generation = (this.generation || 0) + 1;
    clearInterval(this.timer);
    for (const connection of Object.values(this.connections)) connection.close();
    this.connections = {};
    this.state = { ...this.state, status: 'idle', planId: null, phase: 'waiting', message: 'Tracking stopped. Any recorded landings are saved in this flight.' };
    this.emit({ ...this.status(), plan });
    return this.status();
  }
}
