import { Clock3, Radio } from 'lucide-react';
import { elapsedTime, offBlockCountdown, timingComparison, timingDelta } from '../shared/flight-timing.mjs';
import type { Plan, TelemetryState } from './types';
import './timing.css';

const utc = (value: string | null) => value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + 'Z' : '—';
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }) : 'Awaiting observation';
export default function LiveTimings({ plan, telemetry, now }: { plan: Plan; telemetry: TelemetryState | null; now: number }) {
  const tracking = telemetry?.planId === plan.id;
  const { events, windows } = timingComparison(plan, now, tracking);
  const departure = offBlockCountdown(plan, now);
  const phase = plan.actual?.phase || 'waiting';
  const label = phase === 'complete' ? 'Flight complete' : !tracking && plan.actual ? 'Tracking stopped' :
    telemetry?.status === 'paused' && tracking ? 'Simulator paused' :
    phase === 'taxi-out' ? 'Taxiing out' : phase === 'airborne' ? 'Airborne' : phase === 'taxi-in' ? 'Taxiing in' : 'Waiting for departure';
  return <section className="card live-timings" aria-label="Live flight timings">
    <div className="card-title"><div><h2><Clock3 size={18}/> Live flight timeline</h2><p>Actual UTC times against your SimBrief plan</p></div><span className={`tag ${tracking ? 'success-tag' : ''}`}><Radio size={12}/>{label}</span></div>
    {['countdown', 'overdue'].includes(departure.state) && <div className={`offblock-countdown ${departure.state}`} role="region" aria-label="Off-block countdown">
      <div><span className="eyebrow">{departure.state === 'overdue' ? 'OFF BLOCKS OVERDUE' : 'UNTIL OFF BLOCKS'}</span><p>Planned {utc(departure.target)} · {date(departure.target)}</p></div>
      <strong>{departure.state === 'overdue' ? '+' : ''}{elapsedTime(departure.seconds)}</strong>
    </div>}
    {departure.state === 'departed' && <p className="departure-recorded">Off blocks recorded at {utc(departure.target)} · Countdown complete</p>}
    <div className="actual-milestones">{events.map(event => <div key={event.key} className={event.actual ? 'observed' : ''}>
      <h3>{event.label}</h3><strong>{utc(event.actual)}</strong><span>{date(event.actual)}</span>
      <small>Plan {utc(event.planned)}{event.planned && event.actual?.slice(0, 10) !== event.planned.slice(0, 10) ? ` · ${date(event.planned)}` : ''}</small>
      <b className={event.delta != null && event.delta > 0 ? 'timing-over' : 'timing-under'}>{timingDelta(event.delta)}</b>
    </div>)}</div>
    <div className="duration-comparison"><table><thead><tr><th>Time window</th><th>Planned</th><th>Actual / elapsed</th><th>Difference</th></tr></thead>
      <tbody>{windows.map(window => <tr key={window.key} className={window.live ? 'timing-live' : ''}>
        <th scope="row">{window.label}{window.live && <span>LIVE</span>}</th><td>{elapsedTime(window.planned)}</td><td>{elapsedTime(window.actual)}</td>
        <td className={window.delta != null && window.delta > 0 ? 'timing-over' : 'timing-under'}>{timingDelta(window.delta, window.live)}</td>
      </tr>)}</tbody></table></div>
    <p className="timing-explainer">Off blocks: first sustained movement after stopping. On block: parked below 3 kt with the parking brake set for 5 seconds. Elapsed time uses the real UTC clock, including simulator pauses. Unobserved events stay blank.</p>
    {tracking && ['waiting', 'paused', 'error'].includes(telemetry.status) && <p className="timing-connection" role="status">{telemetry.message}</p>}
  </section>;
}
