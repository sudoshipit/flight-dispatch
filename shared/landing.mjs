const finite = Number.isFinite;
export function distanceNm(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(finite)) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Read-only telemetry. Require observed flight before recognizing ground contact.
export class LandingRecorder {
  constructor(actual = {}) {
    this.contacts = []; this.phase = 'waiting';
    this.actual = { out: null, off: null, on: null, in: null, phase: 'waiting', lastObservedAt: null, ...actual };
    this.resetContinuity();
  }
  resetContinuity() {
    this.previous = null; this.airSince = null; this.armed = false; this.parkedSince = null; this.pending = null;
    this.groundReady = false; this.movingSince = null; this.takeoffAt = null;
    if (this.phase !== 'complete') this.phase = 'waiting';
  }
  ingest(sample) {
    const s = sample;
    if (!s || ![s.at, s.simTime, s.agl, s.verticalSpeed, s.groundspeed, s.lat, s.lon].every(finite) || typeof s.onGround !== 'boolean' ||
        Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180 || s.paused || s.slew || s.replay || s.running === false) {
      this.resetContinuity(); return false;
    }
    if (this.phase === 'complete') return false;
    let previous = this.previous;
    if (previous) {
      const elapsed = s.at - previous.at, simElapsed = s.simTime - previous.simTime;
      if (elapsed <= 0 || simElapsed === 0) return false;
      if (elapsed > 2000 || simElapsed < 0 || simElapsed > elapsed / 1000 * 64 + 2 ||
          (distanceNm(s, previous) ?? 0) > Math.max(1, simElapsed * 1200 / 3600)) {
        this.resetContinuity(); previous = null;
      }
    }
    let changed = false;
    this.actual.lastObservedAt = new Date(s.at).toISOString();
    // MSFS can update its touchdown-specific SimVar one frame after ground contact.
    if (this.pending && s.at - this.pending.at <= 600 && s.onGround &&
        finite(s.touchdownVelocity) && s.touchdownVelocity !== this.pending.baseline && Math.abs(s.touchdownVelocity) < 200) {
      const contact = this.contacts.at(-1);
      contact.rateFpm = -Math.round(Math.abs(s.touchdownVelocity) * 60);
      contact.method = 'simulator-touchdown';
      this.pending = null; changed = true;
    }
    if (!s.onGround) {
      this.parkedSince = null;
      if (previous?.onGround) this.takeoffAt = s.at;
      this.airSince ??= s.at;
      if (s.at - this.airSince >= 3000 && s.agl >= 30) {
        this.armed = true; this.phase = 'airborne';
        if (this.actual.phase !== 'airborne') {
          // Only timestamp a takeoff we actually observed, never a midair spawn.
          if (!this.actual.off && this.takeoffAt != null) this.actual.off = new Date(this.takeoffAt).toISOString();
          this.actual.on = null; this.actual.in = null; this.actual.phase = 'airborne'; changed = true;
        }
      }
    } else {
      if (!this.actual.off && !this.contacts.length) {
        if (s.groundspeed < 1) this.groundReady = true;
        if (this.groundReady && s.groundspeed >= 1 && !s.parkingBrake) {
          this.movingSince ??= s.at;
          if (!this.actual.out && s.at - this.movingSince >= 2000) {
            this.actual.out = new Date(this.movingSince).toISOString();
            this.actual.phase = 'taxi-out'; changed = true;
          }
        } else this.movingSince = null;
      }
      const latest = this.contacts.at(-1);
      const bounce = latest && s.at - latest.at <= 10000 && previous?.agl < 30 && this.phase === 'landed';
      if (previous && !previous.onGround && (this.armed || bounce)) {
        const native = finite(s.touchdownVelocity) && s.touchdownVelocity !== previous.touchdownVelocity && Math.abs(s.touchdownVelocity) < 200;
        const rateFpm = native ? -Math.round(Math.abs(s.touchdownVelocity) * 60) :
          previous.verticalSpeed <= 0 && previous.verticalSpeed > -12000 ? Math.round(previous.verticalSpeed) : null;
        this.contacts.push({
          at: s.at, time: new Date(s.at).toISOString(), rateFpm,
          method: native ? 'simulator-touchdown' : 'sampled-estimate', bounce: Boolean(bounce),
          groundspeed: Math.round(s.groundspeed), pitch: finite(s.pitch) ? s.pitch : null,
          bank: finite(s.bank) ? s.bank : null, lat: s.lat, lon: s.lon,
          sampleAgeMs: s.at - previous.at,
        });
        // Bound disk/UI growth during long practice sessions.
        this.contacts = this.contacts.slice(-50);
        this.pending = native ? null : { at: s.at, baseline: previous.touchdownVelocity };
        this.armed = false; this.phase = 'landed'; changed = true;
        if (!bounce) this.actual.on = new Date(s.at).toISOString();
        this.actual.phase = 'taxi-in';
      }
      this.airSince = null;
      if (this.phase === 'landed' && s.groundspeed < 3 && s.parkingBrake) {
        this.parkedSince ??= s.at;
        if (s.at - this.parkedSince >= 5000) {
          this.phase = 'complete'; changed = true;
          this.actual.in = new Date(this.parkedSince).toISOString(); this.actual.phase = 'complete';
        }
      } else this.parkedSince = null;
    }
    this.previous = s;
    return changed;
  }
}
