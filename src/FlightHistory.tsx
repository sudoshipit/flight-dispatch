import { useState } from 'react';
import { ArrowRight, ChevronRight, Plane, Search, X } from 'lucide-react';
import { flightHistoryView } from '../shared/briefing-tools.mjs';
import type { Plan } from './types';
import './workflow.css';

const date = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + 'Z';
export default function FlightHistory({ flights, busy, now, open }: { flights: Plan[]; busy: boolean; now: number; open: (plan: Plan) => void }) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('saved');
  const visible = flightHistoryView(flights, { search, filter, sort, now }) as Plan[];
  const reset = () => { setSearch(''); setFilter('all'); setSort('saved'); };
  return <section className="flight-history" aria-label="Saved flight history">
    <div className="history-tools">
      <label className="history-search"><Search size={17}/><input aria-label="Search recent flights" value={search} placeholder="Callsign, airport, aircraft or registration" onChange={e => setSearch(e.target.value)}/>{search && <button className="icon-button" aria-label="Clear flight search" onClick={() => setSearch('')}><X size={15}/></button>}</label>
      <label>Show<select aria-label="Filter recent flights" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All flights</option><option value="upcoming">Upcoming</option><option value="complete">Completed</option><option value="attention">Filing needs attention</option></select></label>
      <label>Sort<select aria-label="Sort recent flights" value={sort} onChange={e => setSort(e.target.value)}><option value="saved">Recently saved</option><option value="departure">Departure · earliest first</option></select></label>
    </div>
    <p className="history-count">{visible.length} of {flights.length} flights · all times UTC{(search || filter !== 'all' || sort !== 'saved') && <button className="text-button" onClick={reset}>Reset filters</button>}</p>
    <div className="history-list">{visible.map(p => <button className="history-row" key={p.id} disabled={busy} onClick={() => open(p)}>
      <span className="history-icon"><Plane size={21}/></span>
      <div><strong>{p.callsign}</strong><small>{p.aircraft} · {date(p.offBlock)}</small>{p.actual?.phase === 'complete' || p.landing?.completedAt ? <small className="history-complete">Flight complete</small> : null}</div>
      <span className="history-route">{p.origin.icao}<ArrowRight size={17}/>{p.destination.icao}</span>
      {p.landing?.contacts.length ? <span className="history-landing">{p.landing.contacts.at(-1)?.rateFpm ?? '—'} ft/min</span> : null}
      <span className={`tag ${['failed','unconfirmed'].includes(p.filing.status) ? 'history-attention' : ''}`}>{({ filed: 'Filed', pending: 'Filing pending', failed: 'Filing failed', unconfirmed: 'Filing unconfirmed', 'not-filed': 'Not filed' })[p.filing.status]}</span><ChevronRight size={17}/>
    </button>)}</div>
    {!visible.length && <div className="history-empty"><Search size={26}/><h2>No matching flights</h2><p>Try another airport or callsign, or show all saved flights.</p><button className="secondary-button" onClick={reset}>Show all flights</button></div>}
  </section>;
}
