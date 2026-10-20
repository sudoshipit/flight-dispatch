import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { Progress, Result, SimbriefFlight } from './types';
import './simbrief-picker.css';

const date = (value: string) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + 'Z' : 'None';
export default function SimbriefPicker({ close, imported, busyChanged, progress }: {
  close: () => void; imported: (result: Result) => void; busyChanged: (busy: string) => void; progress: Progress | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null), started = useRef(false), running = useRef(false);
  const [flights, setFlights] = useState<SimbriefFlight[]>([]);
  const [selected, setSelected] = useState(''), [search, setSearch] = useState(''), [upcoming, setUpcoming] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const run = async (name: string, work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(name); busyChanged(name); setError('');
    try { await work(); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { running.current = false; setBusy(''); busyChanged(''); }
  };
  const refresh = () => run('import-list', async () => {
    setSelected(''); setFlights([]); setLoaded(false);
    const value = await window.dispatch.simbriefFlights(); setFlights(value); setLoaded(true);
  });
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    if (!started.current) { started.current = true; void refresh(); }
    return () => element.close();
  }, []);
  const filtered = flights.filter(flight => (!upcoming || Date.parse(flight.offBlock) >= Date.now())
    && `${flight.callsign} ${flight.origin} ${flight.destination} ${flight.aircraft} ${flight.registration}`.toLowerCase().includes(search.toLowerCase().trim()));
  const chosen = filtered.find(flight => flight.id === selected);
  return <dialog ref={dialog} className="simbrief-picker" aria-labelledby="simbrief-picker-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><div><div className="eyebrow green">YOUR SIMBRIEF ACCOUNT</div><h2 id="simbrief-picker-title">Choose a flight plan</h2></div><button className="icon-button" aria-label="Close flight picker" disabled={!!busy} onClick={close}><X size={20}/></button></header>
    <p className="helper">Generated plans saved in SimBrief, including later departures. Times are UTC. Importing opens the briefing without generating or filing a new flight.</p>
    <div className="picker-tools"><label><Search size={16}/><input aria-label="Search SimBrief flights" autoFocus placeholder="Search callsign, airport or aircraft" value={search} onChange={e => setSearch(e.target.value)}/></label><label className="picker-upcoming"><input type="checkbox" checked={upcoming} onChange={e => { setUpcoming(e.target.checked); setSelected(''); }}/> Upcoming only</label><button className="secondary-button" disabled={!!busy} onClick={refresh}><RefreshCw size={14}/> Refresh list</button></div>
    {busy && <div className="picker-progress" role="status"><LoaderCircle size={18} className="spin"/><span>{progress?.message || (busy === 'import-list' ? 'Loading your SimBrief flight plans…' : 'Importing the selected flight…')}</span></div>}
    {error && <p className="picker-error" role="alert">{error}</p>}
    <div className="picker-list" role="radiogroup" aria-label="Saved SimBrief flight plans">
      {filtered.map(flight => <label key={flight.id} className={`picker-flight ${selected === flight.id ? 'selected' : ''}`}>
        <input type="radio" name="simbrief-flight" value={flight.id} checked={selected === flight.id} disabled={!!busy} onChange={() => setSelected(flight.id)}/>
        <span><strong>{flight.callsign}</strong><small>{flight.aircraft} · {flight.registration || 'None'}</small></span>
        <span><strong className="picker-route">{flight.origin}<ArrowRight size={15}/>{flight.destination}</strong><small>Off blocks {date(flight.offBlock)}</small></span>
        <span className="picker-release"><small>Release {flight.release || 'None'}</small><small>Generated {date(flight.generatedAt)}</small></span>
      </label>)}
      {loaded && !filtered.length && <p className="picker-empty">{flights.length ? 'No flights match your search.' : 'No generated flight plans found in this SimBrief account.'}</p>}
    </div>
    <p className="helper">{loaded ? `${filtered.length} of ${flights.length} plans · newest generated first. ` : ''}SimBrief lists up to 500 recent releases. Saved flight options need an OFP generated in SimBrief before they can be imported.</p>
    <div className="picker-actions">{busy ? <button className="secondary-button" onClick={() => { void window.dispatch.cancel().catch(e => setError(e.message)); }}>Cancel operation</button> : <button className="secondary-button" onClick={close}>Cancel</button>}<button className="primary-button" disabled={!!busy || !chosen} onClick={() => run('import-selected', async () => { const result = await window.dispatch.importSelected(selected); imported(result); close(); })}><Download size={16}/> Import selected flight</button></div>
  </dialog>;
}
