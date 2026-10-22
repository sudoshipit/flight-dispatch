import { ArrowUpRight, CheckCheck, Clock3, Plane } from 'lucide-react';
import { plannedTiming } from '../shared/flight-timing.mjs';
import { formatSeconds } from '../shared/ofp.mjs';
import type { Plan } from './types';
import './flight-banner.css';

export default function FlightBanner({ plan, open }: { plan: Plan; open: (url: string) => void }) {
  const status = plan.filing.status;
  return <section className="flight-banner" aria-label="Flight summary">
    <div className="flight-banner-identity">
      <button className="callsign-link" title="Open this flight on SimBrief" onClick={() => open(plan.ofpUrl)}>{plan.callsign}<ArrowUpRight size={17}/></button>
      <small>{plan.aircraft} · {plan.registration}</small>
    </div>
    <div className="flight-banner-route">
      <div><span className="eyebrow">DEPARTURE</span><strong>{plan.origin.icao}</strong><p title={plan.origin.name}>{plan.origin.name}</p></div>
      <div className="flight-banner-distance"><Plane size={19}/><span>{plan.timingOverride ? formatSeconds(plannedTiming(plan).airborneSeconds) : `${Number(plan.enroute.slice(0, 2))}h ${plan.enroute.slice(2)}m`}</span><small>{plan.distance == null ? '—' : plan.distance.toLocaleString()} NM</small></div>
      <div className="align-right"><span className="eyebrow">DESTINATION</span><strong>{plan.destination.icao}</strong><p title={plan.destination.name}>{plan.destination.name}</p></div>
    </div>
    <span className={`tag ${status === 'filed' ? 'success-tag' : 'pending-tag'}`}>
      {status === 'filed' ? <CheckCheck size={14}/> : <Clock3 size={14}/>}
      {status === 'filed' ? 'Filed on VATSIM' : status === 'unconfirmed' ? 'Filing unconfirmed' : status === 'failed' ? 'Filing failed' : 'Not yet filed'}
    </span>
  </section>;
}
