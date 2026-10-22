import { useState } from 'react';
import { Check, Pencil, RotateCcw } from 'lucide-react';
import { elapsedTime, plannedTiming, timingComparison, validateTimingOverride } from '../shared/flight-timing.mjs';
import { userMessage } from '../shared/briefing-tools.mjs';
import type { Plan, TimingOverride } from './types';

type Props = { plan: Plan; busy: boolean; save: (id: string, input: TimingOverride | null) => Promise<void> };
const fields = [['taxiOutSeconds', 'Taxi-out', 360], ['airborneSeconds', 'Air time', 2880], ['taxiInSeconds', 'Taxi-in', 360]] as const;
const utc = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + 'Z' : 'None';

export default function TimingEditor(props: Props) {
  const [editing, setEditing] = useState(false);
  return <div className="timing-editor">
    {!editing ? <div className="timing-edit-action"><button className="text-button" disabled={props.busy} onClick={() => setEditing(true)}><Pencil size={14}/> Edit timings</button>{props.plan.timingOverride && <span className="tag">Local timings</span>}</div> :
      <TimingForm {...props} close={() => setEditing(false)}/>}
  </div>;
}
function TimingForm({ plan, busy, save, close }: Props & { close: () => void }) {
  const [draft, setDraft] = useState(() => {
    const { events, windows } = timingComparison(plan, Date.now());
    const out = events[0].planned || '';
    const minutes = (index: number) => windows[index].planned == null ? '' : String(Number((windows[index].planned / 60).toFixed(3)));
    return { date: out.slice(0, 10), time: out.slice(11, 19), taxiOutSeconds: minutes(0), airborneSeconds: minutes(1), taxiInSeconds: minutes(2) };
  });
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const input: TimingOverride = { offBlock: `${draft.date}T${draft.time.length === 5 ? draft.time + ':00' : draft.time}.000Z`,
    taxiOutSeconds: draft.taxiOutSeconds.trim() === '' ? null : Math.round(Number(draft.taxiOutSeconds) * 60),
    airborneSeconds: draft.airborneSeconds.trim() === '' ? null : Math.round(Number(draft.airborneSeconds) * 60),
    taxiInSeconds: draft.taxiInSeconds.trim() === '' ? null : Math.round(Number(draft.taxiInSeconds) * 60) };
  let preview;
  try { validateTimingOverride(input); preview = plannedTiming({ ...plan, timingOverride: input }); } catch { /* Show validation on save; keep incomplete drafts editable. */ }
  const commit = async (value: TimingOverride | null) => {
    if (saving || busy) return;
    setSaving(true); setError('');
    try { validateTimingOverride(value); await save(plan.id, value); close(); }
    catch (e) { setError(userMessage(e)); }
    finally { setSaving(false); }
  };
  return <form className="timing-edit-form" aria-label="Edit planned timings" onSubmit={e => { e.preventDefault(); void commit(input); }}>
    <h3>Edit planned timings</h3><p>Update this briefing’s schedule. All times are UTC.</p>
    <fieldset disabled={saving || busy}>
      <div className="timing-edit-fields">
        <label className="field"><span>Departure date · UTC</span><input aria-label="Planned departure date" type="date" min="2000-01-01" max="2100-12-31" value={draft.date} required autoFocus onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}/></label>
        <label className="field"><span>Off blocks · UTC</span><input aria-label="Planned off-block time" type="time" step="1" value={draft.time} required onChange={e => setDraft(d => ({ ...d, time: e.target.value }))}/></label>
        {fields.map(([key, label, max]) => <label key={key} className="field"><span>{label} · minutes</span><input aria-label={`Planned ${label.toLowerCase()} minutes`} type="number" min={key === 'airborneSeconds' ? 1 / 60 : 0} max={max} step="any" placeholder="None" value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}/></label>)}
      </div>
      <p className="timing-edit-hint">Leave an unknown duration blank. Takeoff, touchdown and on-block times are calculated from these durations.</p>
      {preview && <dl className="timing-edit-preview" aria-label="Timing preview"><div><dt>Takeoff</dt><dd>{utc(preview.off.estimated)}</dd></div><div><dt>Touchdown</dt><dd>{utc(preview.on.estimated)}</dd></div><div><dt>On block</dt><dd>{utc(preview.in.estimated)}</dd></div><div><dt>Total block</dt><dd>{elapsedTime(preview.blockSeconds)}</dd></div></dl>}
      <p className="timing-edit-hint">Saved in Flight Dispatch only. SimBrief, VATSIM, fuel calculations and recorded actual times stay unchanged.</p>
      {error && <p className="timing-edit-error" role="alert">{error}</p>}
      <div className="timing-edit-buttons"><button className="primary-button" type="submit"><Check size={14}/>{saving ? 'Saving…' : 'Save timings'}</button><button className="secondary-button" type="button" onClick={close}>Cancel</button>
        {plan.timingOverride && <button className="text-button" type="button" onClick={() => void commit(null)}><RotateCcw size={13}/> Reset to SimBrief</button>}</div>
    </fieldset>
  </form>;
}
