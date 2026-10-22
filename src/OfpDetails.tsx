import { ChevronDown, Clock3, Fuel, Gauge, Route, Scale, Wind } from 'lucide-react';
import { formatSeconds, formatWind, formatWindComponent } from '../shared/ofp.mjs';
import { plannedTiming } from '../shared/flight-timing.mjs';
import type { Plan, TimeEvent } from './types';

const fmt = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-US');
const signed = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n}`;
const time = (date: string | null) => date ? new Date(date).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + 'Z' : '—';
const day = (date: string | null) => date ? new Date(date).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }) : 'Not supplied';
function TimeStop({ label, event }: { label: string; event: TimeEvent }) {
  return <div className="time-stop"><span className="eyebrow">{label}</span><strong>{time(event.estimated)}</strong><span>{day(event.estimated)}</span><small>Sched. {time(event.scheduled)}{event.scheduled && event.scheduled.slice(0, 10) !== event.estimated?.slice(0, 10) ? ` · ${day(event.scheduled)}` : ''}</small></div>;
}
export function ProcedureDetails({ plan }: { plan: Plan }) {
  const data = plan.ofp;
  if (!data) return null;
  return <section className="card procedures-card" aria-label="SID and STAR">
      <div className="card-title"><h2><Route size={17}/> Departure & arrival procedures</h2></div>
      <div className="procedures-grid">{([['departure', 'SID', plan.origin.icao], ['arrival', 'STAR', plan.destination.icao]] as const).map(([key, label, airport]) => {
        const procedure = data.procedures[key];
        return <div key={key}><span className="eyebrow">{airport} · {label}</span><strong>{procedure.name || 'None'}</strong><div><span>Transition <b>{procedure.transition || 'None'}</b></span><span>Runway <b>{procedure.runway || 'None'}</b></span></div></div>;
      })}</div>
    </section>;
}

export default function OfpDetails({ plan }: { plan: Plan }) {
  const data = plan.ofp;
  if (!data) return <p className="ofp-legacy">This saved briefing predates the detailed OFP view. Import the flight again while it is your latest SimBrief plan to load these details.</p>;
  const { fuel: f, cruise: c, weights: w } = data;
  const t = plannedTiming(plan);
  const units = ['LBS', 'KGS'].includes(plan.units) ? plan.units : 'units unspecified';
  const fuelRows: [string, number | null, string?][] = [
    ['Taxi', f.taxi], ['Trip', f.trip], ['Contingency', f.contingency, f.contingencyRule],
    ['Alternate', f.alternate, plan.alternate], ['Final reserve', f.reserve, formatSeconds(t.reserveSeconds)],
    ['Extra', f.extra], ['ETOPS', f.etops],
  ];
  return <section className="ofp-details" aria-label="SimBrief OFP details">
    <div className="section-heading"><h2><Clock3 size={18}/> Planned flight</h2><span className="ofp-source">OFP snapshot · AIRAC {data.airac || 'not supplied'}</span></div>
    <section className="card timing-card" aria-label="Planned timings">
      <div className="timing-heading"><h3>{plan.timingOverride ? 'Locally adjusted timeline' : 'Estimated timeline'}</h3><span>All times UTC</span></div>
      <div className="flight-timeline"><TimeStop label="OFF BLOCK" event={t.out}/><TimeStop label="TAKEOFF" event={t.off}/><TimeStop label="LANDING" event={t.on}/><TimeStop label="ON BLOCK" event={t.in}/></div>
      <div className="timing-durations"><span>Taxi out <b>{formatSeconds(t.taxiOutSeconds)}</b></span><span>Airborne <b>{formatSeconds(t.airborneSeconds)}</b></span><span>Taxi in <b>{formatSeconds(t.taxiInSeconds)}</b></span><span>Block time <b>{formatSeconds(t.blockSeconds)}</b></span></div>
    </section>
    <div className="ofp-grid">
      <section className="card fuel-card" aria-label="Planned fuel">
        <div className="card-title"><h2><Fuel size={17}/> Planned fuel</h2><span className="ofp-unit">{units}</span></div>
        <div className="fuel-highlights"><div><span className="eyebrow">BLOCK / RAMP</span><strong>{fmt(f.block)}</strong></div><div><span className="eyebrow">AT LANDING</span><strong>{fmt(f.landing)}</strong></div></div>
        <dl className="ofp-values">{fuelRows.map(([label, value, note]) => <div key={label}><dt>{label}{note && note !== '—' && <small>{note}</small>}</dt><dd>{fmt(value)}</dd></div>)}</dl>
        <div className="fuel-foot"><span>Takeoff <b>{fmt(f.takeoff)}</b></span><span>Minimum takeoff <b>{fmt(f.minimumTakeoff)}</b></span><span>Average flow <b>{fmt(f.averageFlow)} {units}/hr</b></span><span>Endurance <b>{formatSeconds(t.enduranceSeconds)}</b></span></div>
      </section>
      <section className="card winds-card" aria-label="Planned winds and cruise">
        <div className="card-title"><h2><Wind size={17}/> Winds & cruise</h2><span className="ofp-unit">PLANNED</span></div>
        <div className="wind-highlight"><span className="eyebrow">AVERAGE WIND</span><strong>{formatWind(c.windDirection, c.windSpeed)}</strong><span>{formatWindComponent(c.windComponent)}</span></div>
        <dl className="ofp-values">
          <div><dt>Cost index</dt><dd>{fmt(plan.costIndex)}</dd></div><div><dt>Cruise profile</dt><dd>{c.profile || '—'}</dd></div>
          <div><dt>Mach / true airspeed</dt><dd>{c.mach == null ? '—' : c.mach.toFixed(2)} / {fmt(plan.speed)} kt</dd></div>
          <div><dt>Average ISA deviation</dt><dd>{signed(c.isaDeviation)} °C</dd></div><div><dt>Average tropopause</dt><dd>{fmt(c.tropopause)} ft</dd></div>
          <div><dt>Climb profile</dt><dd>{c.climb || '—'}</dd></div><div><dt>Descent profile</dt><dd>{c.descent || '—'}</dd></div>
        </dl>
        <div className="step-climbs"><span className="eyebrow">ALTITUDE / STEP PLAN</span><p>{c.stepClimbs || 'None'}</p></div>
      </section>
    </div>
    <details className="card ofp-disclosure"><summary><span><Scale size={17}/> Weights & payload</span><small>{units}</small><ChevronDown size={16}/></summary><div className="weights-grid">{[['Zero fuel', w.zeroFuel, w.maxZeroFuel], ['Takeoff', w.takeoff, w.maxTakeoff], ['Landing', w.landing, w.maxLanding]].map(([label, value, limit]) => <div key={String(label)}><span>{label}</span><strong>{fmt(value as number | null)}</strong><small>OFP limit {fmt(limit as number | null)}</small></div>)}</div><div className="timing-durations"><span>Payload <b>{fmt(w.payload)} {units}</b></span><span>Cargo <b>{fmt(w.cargo)} {units}</b></span></div></details>
    <details className="card ofp-disclosure navlog-disclosure"><summary><span><Gauge size={17}/> Waypoint winds & fuel</span><small>{data.navlog.length} fixes</small><ChevronDown size={16}/></summary>
      <p className="navlog-note">Original OFP winds and times. ETO = SimBrief takeoff + cumulative flight time; local timing edits do not recalculate this log. Fuel is planned remaining in {units}.</p>
      {data.navlog.length ? <div className="navlog-scroll" tabIndex={0} role="region" aria-label="Scrollable waypoint log"><table className="navlog-table"><thead><tr>{['Waypoint', 'Altitude ft', 'ETO UTC', 'Wind ° / kt', 'OAT °C', 'GS kt', `Fuel ${units}`].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.navlog.map((fix, index) => <tr key={`${index}-${fix.ident}`} className={['TOC', 'TOD'].includes(fix.ident) ? 'milestone' : ''}><th scope="row">{fix.ident}<small>{fix.airway} · {fix.stage}</small></th><td>{fmt(fix.altitude)}</td><td>{time(fix.eta)}<small>{fix.eta && day(fix.eta)}</small></td><td>{formatWind(fix.windDirection, fix.windSpeed)}</td><td>{fmt(fix.temperature)}</td><td>{fmt(fix.groundspeed)}</td><td>{fmt(fix.fuelRemaining)}</td></tr>)}</tbody></table></div> : <p className="navlog-note">This OFP has no detailed navigation log.</p>}
    </details>
    <p className="ofp-footnote">Fuel, winds, weights and waypoint times belong to the original SimBrief plan. Local timing edits update the timeline only; refreshing weather does not recalculate the plan.</p>
  </section>;
}
