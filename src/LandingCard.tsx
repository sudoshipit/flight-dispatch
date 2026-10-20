import { useState } from 'react';
import { Activity, PlaneLanding, Radio, Square } from 'lucide-react';
import type { Plan, TelemetryConfig, TelemetryState } from './types';
import './landing.css';

const time = (date: string) => new Date(date).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 'Z';
export default function LandingCard({ plan, telemetry, start, stop }: {
  plan: Plan; telemetry: TelemetryState | null;
  start: (config: TelemetryConfig) => Promise<void>; stop: () => Promise<void>;
}) {
  const [config, setConfig] = useState<TelemetryConfig>(telemetry?.config || { simulator: 'auto', xplanePort: 49000 });
  const [working, setWorking] = useState(false);
  const active = telemetry?.planId === plan.id;
  const otherFlight = telemetry?.planId && !active;
  const summary = plan.landing;
  const latest = summary?.contacts.at(-1);
  const rates = summary?.contacts.map(contact => contact.rateFpm).filter((rate): rate is number => rate != null) || [];
  const run = async (fn: () => Promise<void>) => { setWorking(true); try { await fn(); } finally { setWorking(false); } };
  return <section className={`card landing-card${latest ? ' has-landing' : ''}`} aria-label={latest ? 'Landing summary' : 'Flight recorder'}>
    <div className="landing-heading"><span className="mini-icon">{latest ? <PlaneLanding size={21}/> : <Activity size={21}/>}</span><div><h2>{latest ? 'Your landing' : 'Flight recorder'}</h2><p>{latest ? `${summary?.simulator} · ${summary?.completedAt ? 'Flight complete' : 'Touchdown recorded'}` : 'Detects your simulator and records landing rate automatically.'}</p></div>
      {active && <span className={`tag ${telemetry.status === 'tracking' ? 'success-tag' : ''}`}><Radio size={12}/> {telemetry.status === 'tracking' ? 'Recording' : telemetry.status === 'paused' ? 'Paused' : telemetry.status === 'error' ? 'Save failed' : 'Connecting'}</span>}
    </div>
    {latest && <>
      <div className="landing-results"><div className="landing-rate"><span className="eyebrow">LATEST TOUCHDOWN</span><strong>{latest.rateFpm == null ? '—' : latest.rateFpm.toLocaleString('en-US')}<small> ft/min</small></strong><span>{latest.method === 'simulator-touchdown' ? 'Simulator touchdown measurement' : `Estimated from last airborne sample · ${latest.sampleAgeMs} ms before contact`}</span></div>
        <dl><div><dt>Touchdown UTC</dt><dd>{time(latest.time)}</dd></div><div><dt>Groundspeed</dt><dd>{latest.groundspeed} kt</dd></div><div><dt>Pitch / bank</dt><dd>{latest.pitch?.toFixed(1) ?? '—'}° / {latest.bank?.toFixed(1) ?? '—'}°</dd></div><div><dt>Ground contacts</dt><dd>{summary!.contacts.length}{summary!.contacts.some(contact => contact.bounce) ? ' · bounce detected' : ''}</dd></div></dl>
      </div>
      <p className="landing-note">{latest.destinationDistanceNm == null ? 'Touchdown position saved.' : `${latest.destinationDistanceNm.toFixed(1)} NM from ${plan.destination.icao}${latest.destinationDistanceNm > 10 ? ' · away from the planned destination' : ''}.`} {rates.length > 1 && `Firmest recorded contact: ${Math.min(...rates).toLocaleString('en-US')} ft/min.`} Negative values indicate descent. Landing rate alone does not grade landing quality.</p>
      {summary!.contacts.length > 1 && <details className="landing-contacts"><summary>All recorded contacts</summary><ul>{summary!.contacts.map((contact, index) => <li key={index}><span>{time(contact.time)}{contact.bounce ? ' · bounce' : ''}</span><strong>{contact.rateFpm ?? '—'} ft/min <small>{contact.method === 'sampled-estimate' ? '(estimated)' : ''}</small></strong></li>)}</ul></details>}
    </>}
    {active ? <div className="landing-controls"><p role="status">{telemetry.message}</p><button className="secondary-button" disabled={working} onClick={() => void run(stop)}><Square size={13}/>{latest || ['landed', 'complete'].includes(telemetry.phase) ? 'Finish tracking' : 'Stop tracking'}</button></div> : !latest && <>
      <div className="landing-controls"><label>Simulator<select aria-label="Tracking simulator" value={config.simulator} onChange={event => setConfig(old => ({ ...old, simulator: event.target.value as TelemetryConfig['simulator'] }))}><option value="auto">Auto detect</option><option value="simconnect">MSFS 2020 / 2024 · FSX / Prepar3D</option><option value="xplane">X-Plane 11 / 12</option></select></label>
        <button className="secondary-button" disabled={working || !!otherFlight} onClick={() => void run(() => start(config))}><Radio size={14}/>Resume tracking</button>
      </div>
      <p className="landing-note">{otherFlight ? `Currently tracking ${telemetry.callsign}. Finish that session before starting this one.` : 'Tracking is stopped for this flight. Resume before takeoff and keep Flight Dispatch open. Landing rate appears on the briefing and in a centered popup.'}</p>
      <details className="landing-setup"><summary>Connection setup</summary><p>MSFS, FSX and Prepar3D use SimConnect discovery. X-Plane uses its built-in UDP interface on this PC; no plugin is required. Auto detect locks to the first simulator that supplies telemetry. Select a simulator explicitly if both are running.</p><label>X-Plane UDP port<input aria-label="X-Plane UDP port" type="number" min={1024} max={65535} value={config.xplanePort} onChange={event => setConfig(old => ({ ...old, xplanePort: Number(event.target.value) }))}/></label><p>Connect during live flight, with replay off. Sampled estimates depend on telemetry frequency and may differ from a simulator-native touchdown measurement.</p></details>
    </>}
  </section>;
}
