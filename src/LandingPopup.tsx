import { useEffect, useRef } from 'react';
import { ArrowRight, PlaneLanding, X } from 'lucide-react';
import type { Plan } from './types';
import './landing.css';

export default function LandingPopup({ plan, dismiss, viewBriefing }: {
  plan: Plan; dismiss: () => void; viewBriefing: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const landing = plan.landing!;
  const latest = landing.contacts.at(-1)!;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="landing-popup" aria-labelledby="landing-popup-title"
    onCancel={event => { event.preventDefault(); dismiss(); }}>
    <button className="icon-button landing-popup-close" aria-label="Dismiss landing popup" onClick={dismiss} autoFocus><X size={20}/></button>
    <div className="landing-popup-icon"><PlaneLanding size={32}/></div>
    <div className="eyebrow green">TOUCHDOWN RECORDED</div>
    <h2 id="landing-popup-title">Your landing rate</h2>
    <p className="landing-popup-flight">{plan.callsign} <span>·</span> {plan.origin.icao} → {plan.destination.icao}</p>
    <div className="landing-popup-rate">{latest.rateFpm == null ? '—' : latest.rateFpm.toLocaleString('en-US')}<span>ft/min</span></div>
    <p className="landing-popup-method">{latest.method === 'simulator-touchdown' ? 'Simulator touchdown measurement' : `Estimated · last airborne sample ${latest.sampleAgeMs} ms before contact`}</p>
    <dl className="landing-popup-details">
      <div><dt>Touchdown UTC</dt><dd>{new Date(latest.time).toLocaleTimeString('en-GB', { timeZone: 'UTC' })}Z</dd></div>
      <div><dt>Groundspeed</dt><dd>{latest.groundspeed} kt</dd></div>
      <div><dt>Ground contacts</dt><dd>{landing.contacts.length}{latest.bounce ? ' · bounce' : ''}</dd></div>
    </dl>
    <p className="landing-note">{landing.simulator} · {landing.completedAt ? 'Flight complete' : 'Saved to your briefing. Tracking continues during rollout.'}</p>
    <p className="landing-note">Negative values indicate descent. Landing rate alone does not grade landing quality.</p>
    <div className="landing-popup-actions"><button className="secondary-button" onClick={dismiss}>Dismiss</button><button className="primary-button" onClick={viewBriefing}>View briefing <ArrowRight size={15}/></button></div>
  </dialog>;
}
