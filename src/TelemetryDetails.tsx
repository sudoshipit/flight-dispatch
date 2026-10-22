import type { TelemetryState } from './types';

export default function TelemetryDetails({ telemetry, now }: { telemetry: TelemetryState; now: number }) {
  const sample = telemetry.sample;
  const age = sample ? Math.max(0, Math.floor((now - Date.parse(sample.receivedAt)) / 1000)) : null;
  const value = (number: number | undefined, unit: string) => number == null ? 'None' : `${Math.round(number).toLocaleString('en-US')} ${unit}`;
  return <details className="telemetry-details">
    <summary>Simulator telemetry <span>{!sample ? 'Waiting for data' : telemetry.status === 'paused' ? 'Paused' : age! > 3 ? `Last sample ${age}s ago` : telemetry.status === 'waiting' ? 'Waiting for telemetry' : 'Receiving data'}</span></summary>
    <div role="region" aria-label="Simulator telemetry"><p>{telemetry.message}</p><dl>
      <div><dt>Simulator</dt><dd>{telemetry.simulator || 'Detecting'}</dd></div>
      <div><dt>Aircraft state</dt><dd>{!sample ? 'Unknown' : sample.onGround ? 'On ground' : 'Airborne'}</dd></div>
      <div><dt>Groundspeed</dt><dd>{value(sample?.groundspeed, 'kt')}</dd></div>
      <div><dt>Parking brake</dt><dd>{sample?.parkingBrake == null ? 'Unknown' : sample.parkingBrake ? 'Set' : 'Released'}</dd></div>
      <div><dt>Height above ground</dt><dd>{value(sample?.agl, 'ft')}</dd></div>
      <div><dt>Vertical speed</dt><dd>{value(sample?.verticalSpeed, 'ft/min')}</dd></div>
    </dl><small>Last valid sample: {sample ? new Date(sample.receivedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + 'Z' : 'None'}. Paused or stale values are shown for reference.</small></div>
  </details>;
}
