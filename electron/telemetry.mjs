import { LandingRecorder, distanceNm } from '../shared/landing.mjs';
import { connectSimConnect, connectXPlane } from './simulators.mjs';

export class Telemetry {
  constructor(store, emit, adapters = { simconnect: connectSimConnect, xplane: connectXPlane }) {
    this.store = store; this.emit = emit; this.adapters = adapters; this.connections = {};
    this.stoppedPlans = new Set();
    this.state = { status: 'idle', message: 'Open a briefing to detect your simulator and record landing rate automatically.', planId: null, callsign: '', simulator: '', phase: 'waiting' };
  }
  status() { return { ...this.state, config: this.store.read('telemetry-settings', { simulator: 'auto', xplanePort: 49000 }) }; }
  follow(id, { replaceWaiting = false } = {}) {
    const plan = this.store.getPlan(String(id));
    if (this.stoppedPlans.has(plan.id) || plan.landing?.contacts.length || this.state.planId === plan.id) return this.status();
    if (this.state.planId) {
      // A connected aircraft at the gate is still awaiting departure. A new
      // dispatch must not leave its recording attached to an older briefing.
      // History browsing and flights already in motion never switch implicitly.
      const last = this.recorder?.previous;
      const parked = last?.onGround && last.groundspeed < 1 &&
        Date.now() - this.lastReceived < 2000 && this.recorder.actual.phase === 'waiting' &&
        !this.recorder.movingSince && !['out', 'off', 'on', 'in'].some(key => this.recorder.actual[key]);
      if (!replaceWaiting || this.recorder?.contacts.length || this.selected && !parked) return this.status();
      this.stop(false);
    }
    const saved = this.store.read('telemetry-settings', {});
    return this.start(plan.id, {
      simulator: ['auto', 'simconnect', 'xplane'].includes(saved.simulator) ? saved.simulator : 'auto',
      xplanePort: Number.isInteger(saved.xplanePort) && saved.xplanePort >= 1024 && saved.xplanePort <= 65535 ? saved.xplanePort : 49000,
    });
  }
  validateStart(id, config) {
    if (!['auto', 'simconnect', 'xplane'].includes(config.simulator) || !Number.isInteger(config.xplanePort) || config.xplanePort < 1024 || config.xplanePort > 65535) throw new Error('Choose a simulator and a valid X-Plane UDP port (1024–65535).');
    const plan = this.store.getPlan(String(id));
    if (plan.landing?.contacts.length) throw new Error('This flight already has landing results. Generate or import a new flight to record another session.');
    return plan;
  }
  switchTo(id, config = {}) {
    // Validate before stopping so an invalid target never interrupts a flight.
    this.validateStart(id, config);
    if (this.state.planId === String(id)) return this.status();
    if (this.state.planId) this.stop();
    return this.start(id, config);
  }
  start(id, config = {}) {
    if (this.state.planId) throw new Error(`Stop tracking ${this.state.callsign} before starting another flight.`);
    const plan = this.validateStart(id, config);
    this.store.write('telemetry-settings', config);
    this.stoppedPlans.delete(plan.id);
    this.recorder = new LandingRecorder(plan.actual); this.startedAt = new Date().toISOString(); this.plan = plan;
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
              // Ignore a simulator's menu, replay or paused feed while detecting
              // which simulator is actually providing a live flight.
              if (sample.paused || sample.replay || sample.slew || sample.running === false ||
                  ![sample.simTime, sample.agl, sample.verticalSpeed, sample.groundspeed, sample.lat, sample.lon].every(Number.isFinite) ||
                  typeof sample.onGround !== 'boolean') return;
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
      this.recorder.phase === 'airborne' ? 'Airborne. Timing your flight and recording touchdown automatically.' :
      this.recorder.phase === 'landed' ? 'Touchdown recorded. Park and set the parking brake, or finish tracking.' :
      this.recorder.phase === 'complete' ? 'Flight complete. Landing results and timings saved.' :
      this.recorder.actual.phase === 'taxi-out' ? 'Taxiing out. Timing your flight and watching for takeoff.' : 'Connected. Waiting for off-block movement and takeoff.';
    let plan;
    if (changed) {
      try { plan = this.save(this.recorder.phase === 'complete'); this.saveError = false; }
      catch { this.saveError = true; }
    }
    if (this.saveError) { this.state.message = 'Flight recording could not be saved. Keep the app open and try stopping or finishing tracking again.'; this.state.status = 'error'; }
    if (changed || Date.now() - this.lastEmit > 500) {
      this.lastEmit = Date.now();
      // A stable contact identifier distinguishes new touchdowns from rate
      // refinements and parking completion, so the UI only opens once per contact.
      this.emit({ ...this.status(), plan, touchdownId: changed && this.recorder.contacts.length ? `${this.state.planId}:${this.recorder.contacts.at(-1).time}` : undefined });
    }
    if (this.recorder.phase === 'complete' && plan) this.stop(false);
  }
  save(complete) {
    const plan = this.store.getPlan(this.state.planId);
    const landing = { startedAt: this.startedAt, completedAt: complete ? new Date().toISOString() : null, simulator: this.state.simulator,
      contacts: this.recorder.contacts.map(contact => ({ ...contact, destinationDistanceNm: distanceNm(contact, this.plan.destination) })) };
    return this.store.savePlan({ ...plan, ...(landing.contacts.length ? { landing } : {}), actual: { ...this.recorder.actual } }, { updateLanding: true, updateActual: true });
  }
  stop(finish = true) {
    let plan;
    if (finish && this.recorder && this.state.planId) plan = this.save(Boolean(this.recorder.contacts.length));
    if (this.state.planId) this.stoppedPlans.add(this.state.planId);
    this.generation = (this.generation || 0) + 1;
    clearInterval(this.timer);
    for (const connection of Object.values(this.connections)) connection.close();
    this.connections = {};
    this.state = { ...this.state, status: 'idle', planId: null, phase: 'waiting', message: 'Tracking stopped. Any recorded landings are saved in this flight.' };
    this.emit({ ...this.status(), plan });
    return this.status();
  }
}
