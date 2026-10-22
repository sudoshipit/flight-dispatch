import fs from 'node:fs';
import { normalizeAircraft, mergePersonalAirframes } from '../shared/aircraft.mjs';
import { fileURLToPath } from 'node:url';
import { parseOFP, selectGates, str, number } from '../shared/domain.mjs';
import { isSimbriefXmlUrl } from './simbrief-import.mjs';

const isoTime = value => { const date = new Date(str(value)); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; };

export async function fetchJson(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'FlightDispatch/1.0 (personal flight simulation companion)', Accept: 'application/json', ...options.headers } }); }
  catch { throw new Error(`Could not reach ${new URL(url).hostname}. Check your connection and try again.`); }
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}${response.status === 429 ? ' (rate limit; try later)' : ''}.`);
  if (response.status === 204) return [];
  const text = await response.text();
  if (text.length > 25_000_000) throw new Error('The service response was too large.');
  try { return JSON.parse(text); } catch { throw new Error(`${new URL(url).hostname} returned an unexpected response.`); }
}

export class Services {
  constructor(store) { this.store = store; this.weatherCache = new Map(); this.aipCache = new Map(); this.gatePending = new Map(); this.positionsPending = new Map(); }
  async airportPositions(ids) {
    if (!Array.isArray(ids) || ids.length > 2 || !ids.length || ids.some(id => typeof id !== 'string' || !/^[A-Z0-9]{4}$/.test(id))) throw new Error('Enter two valid ICAO airports.');
    const key = [...new Set(ids)].sort().join(',');
    if (this.positionsPending.has(key)) return this.positionsPending.get(key);
    const promise = this.lookupPositions([...new Set(ids)]).finally(() => this.positionsPending.delete(key));
    this.positionsPending.set(key, promise);
    return promise;
  }
  async lookupPositions(ids) {
    const cached = this.store.read('airport-positions', {});
    const missing = ids.filter(id => !cached[id] || Date.now() - cached[id].at > 30 * 86400000);
    if (missing.length) {
      try {
        const records = await fetchJson(`https://aviationweather.gov/api/data/airport?${new URLSearchParams({ ids: missing.join(','), format: 'json' })}`);
        if (Array.isArray(records)) for (const r of records) {
          const lat = number(r.lat), lon = number(r.lon);
          if (missing.includes(r.icaoId) && lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) cached[r.icaoId] = { ident: r.icaoId, lat, lon, at: Date.now() };
        }
        this.store.write('airport-positions', Object.fromEntries(Object.entries({ ...this.store.read('airport-positions', {}), ...cached }).sort((a,b) => b[1].at - a[1].at).slice(0, 500)));
      } catch { /* A saved position can still support an offline preview. */ }
    }
    return ids.map(id => cached[id] ? { ident: id, lat: cached[id].lat, lon: cached[id].lon } : { ident: id, lat: null, lon: null });
  }
  async aircraft(refresh = false) {
    const bundled = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/aircraft.json', import.meta.url)), 'utf8').replace(/^\uFEFF/, ''));
    const cached = this.store.read('aircraft', null);
    const merge = result => mergePersonalAirframes(result, this.store.read('personal-airframes', {})[this.store.settings().simbriefId] ?? {});
    if (!refresh && cached?.aircraft?.every(a => Array.isArray(a.variants)) && Date.now() - Date.parse(cached.updatedAt) < 86400000) return merge({ ...cached, mode: 'cached' });
    try {
      const [types, airframes] = await Promise.all([fetchJson('https://www.simbrief.com/api/inputs.list.json'), fetchJson('https://www.simbrief.com/api/inputs.airframes.json')]);
      const aircraft = normalizeAircraft(types, airframes);
      if (aircraft.length < 20) throw new Error('Incomplete aircraft catalog.');
      const result = { aircraft, source: 'SimBrief', updatedAt: new Date().toISOString() };
      this.store.write('aircraft', result);
      return merge({ ...result, mode: 'live' });
    } catch (error) { return merge({ ...(cached?.aircraft?.every(a => Array.isArray(a.variants)) ? cached : bundled), mode: 'offline', warning: `Using saved aircraft catalog. ${error.message}` }); }
  }
  async ofp(staticId) {
    const id = this.store.settings().simbriefId;
    if (!id) throw new Error('Enter your SimBrief Pilot ID or username in Settings and save preferences first.');
    const query = new URLSearchParams({ [/^\d+$/.test(id) ? 'userid' : 'username']: id, json: '1' });
    if (staticId) query.set('static_id', staticId);
    return parseOFP(await fetchJson(`https://www.simbrief.com/api/xml.fetcher.php?${query}`));
  }
  async ofpFile(url) {
    if (!isSimbriefXmlUrl(url)) throw new Error('SimBrief did not provide a supported OFP download.');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`The selected SimBrief OFP could not be downloaded (${response.status}). Try refreshing the list.`);
    const xml = await response.text();
    if (xml.length > 25_000_000) throw new Error('The SimBrief OFP download was too large.');
    return xml;
  }
  async weather(plan) {
    const ids = [plan.origin.icao, plan.destination.icao];
    const key = ids.join(',');
    let cached = this.weatherCache.get(key);
    try {
      if (!cached || Date.now() - cached.at >= 60000) {
        const records = await fetchJson(`https://aviationweather.gov/api/data/metar?${new URLSearchParams({ ids: key, format: 'json' })}`);
        if (!Array.isArray(records)) throw new Error('Unexpected weather data.');
        cached = { at: Date.now(), fetchedAt: new Date().toISOString(), records };
        this.weatherCache.set(key, cached);
      }
      // Cache only the provider response. A missing observation must fall back
      // to this briefing's OFP, never another flight's snapshot of these airports.
      const { records, fetchedAt } = cached;
      return Object.fromEntries(ids.map(icao => {
        const r = records.filter(r => r.icaoId === icao).sort((a, b) => Number(b.obsTime) - Number(a.obsTime))[0];
        return [icao, r ? { raw: str(r.rawOb), observedAt: r.obsTime ? new Date(Number(r.obsTime) * 1000).toISOString() : str(r.reportTime), fetchedAt, category: str(r.fltCat), source: 'NOAA Aviation Weather Center', stale: !r.obsTime || Date.now() - Number(r.obsTime) * 1000 > 90 * 60000 } : this.planWeather(plan, icao, 'No recent observation returned.')];
      }));
    } catch (error) { return Object.fromEntries(ids.map(icao => [icao, this.planWeather(plan, icao, error.message)])); }
  }
  planWeather(plan, icao, error) {
    const airport = plan.origin.icao === icao ? plan.origin : plan.destination;
    return { raw: airport.metar || '', observedAt: airport.metarTime, fetchedAt: null, category: airport.category, source: 'SimBrief snapshot', stale: true, error };
  }
  async airport(icao) {
    const cached = this.aipCache.get(icao);
    if (cached && Date.now() - cached.at < 30 * 60000) return cached.value;
    try {
      const { data } = await fetchJson(`https://my.vatsim.net/api/v2/aip/airports/${encodeURIComponent(icao)}`);
      if (!data || data.icao !== icao) throw new Error('Airport not found in VATSIM AIP.');
      const value = { icao, name: str(data.name), elevation: number(data.altitude_ft), frequencies: (data.stations ?? []).filter(s => s.ctaf === true).map(s => ({ frequency: str(s.frequency), name: str(s.name), callsign: str(s.callsign) })), fetchedAt: new Date().toISOString(), source: 'VATSIM AIP' };
      this.aipCache.set(icao, { at: Date.now(), value });
      return value;
    } catch (error) { return { icao, frequencies: [], error: error.message, source: 'VATSIM AIP' }; }
  }
  async enrich(plan) {
    const [weather, origin, destination, gates] = await Promise.all([this.weather(plan), this.airport(plan.origin.icao), this.airport(plan.destination.icao), this.gates(plan)]);
    return { weather, airports: { [plan.origin.icao]: origin, [plan.destination.icao]: destination }, gates };
  }
  gates(plan) {
    const key = `${plan.callsign}/${plan.origin.icao}/${plan.destination.icao}/${plan.offBlock.slice(0, 10)}`;
    if (this.gatePending.has(key)) return this.gatePending.get(key);
    const promise = this.lookupGates(plan, key).finally(() => this.gatePending.delete(key));
    this.gatePending.set(key, promise);
    return promise;
  }
  async lookupGates(plan, key) {
    const settings = this.store.settings(), provider = settings.gateProvider;
    const records = this.store.read('gate-history', []);
    const fromHistory = () => selectGates(records, plan);
    if (provider === 'none') return { ...fromHistory(), message: 'Automatic gate lookup is off. Saved gate suggestions are shown when available.' };
    const secret = this.store.secret(provider);
    if (!secret) return { ...fromHistory(), needsKey: true, message: 'Add a free Aviationstack key in Settings for automatic gate lookup, or open the flight status page.' };
    const cache = this.store.read('gate-requests', {});
    const cacheKey = `${provider}/${key}`;
    if (cache[cacheKey] && Date.now() - cache[cacheKey].at < 15 * 60000) return { ...fromHistory(), message: cache[cacheKey].message, cached: true };
    const month = new Date().toISOString().slice(0, 7);
    const usage = this.store.read('gate-usage', {});
    const usageKey = `${provider}/${month}`;
    if ((usage[usageKey] ?? 0) >= settings.gateMonthlyLimit) return { ...fromHistory(), message: `Monthly app limit (${settings.gateMonthlyLimit} requests) reached. Saved gates remain available.` };
    // Reserve the request before sending so errors and overlapping operations
    // cannot exceed the local quota. No paid historical endpoints are used.
    usage[usageKey] = (usage[usageKey] ?? 0) + 1;
    this.store.write('gate-usage', usage);
    let message = '', normalized = [];
    try {
      const fetchedAt = new Date().toISOString();
      if (provider === 'aviationstack') {
        const q = new URLSearchParams({ access_key: secret, flight_icao: plan.airline + plan.flightNumber, dep_icao: plan.origin.icao, arr_icao: plan.destination.icao, limit: '100' });
        const response = await fetchJson(`https://api.aviationstack.com/v1/flights?${q}`);
        if (response.error) throw new Error('Aviationstack could not complete the lookup. Check your key, plan access, and quota.');
        normalized = (response.data ?? []).filter(r => r.flight_status !== 'cancelled').map(r => ({ callsign: str(r.flight?.icao), origin: str(r.departure?.icao), destination: str(r.arrival?.icao), date: isoTime(r.departure?.scheduled), departureGate: str(r.departure?.gate), arrivalGate: str(r.arrival?.gate), departureTerminal: str(r.departure?.terminal), arrivalTerminal: str(r.arrival?.terminal), source: 'Aviationstack', fetchedAt }));
      } else {
        const response = await fetchJson(`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(plan.airline + plan.flightNumber)}?max_pages=1`, { headers: { 'x-apikey': secret } });
        normalized = (response.flights ?? []).filter(r => !r.cancelled).map(r => ({ callsign: str(r.ident_icao || r.ident), origin: str(r.origin?.code_icao || r.origin?.code), destination: str(r.destination?.code_icao || r.destination?.code), date: isoTime(r.scheduled_out || r.scheduled_off), departureGate: str(r.gate_origin), arrivalGate: str(r.gate_destination), departureTerminal: str(r.terminal_origin), arrivalTerminal: str(r.terminal_destination), source: 'FlightAware', fetchedAt }));
      }
      normalized = normalized.filter(r => r.date && (r.departureGate || r.arrivalGate) && r.callsign === plan.callsign && r.origin === plan.origin.icao && r.destination === plan.destination.icao);
      if (!normalized.length) message = 'No gates published for this flight and route. Showing saved suggestions when available.';
    } catch (error) { message = error.message; }
    // Merge field by field: a provider response with one missing gate must not
    // erase a previously observed gate for the same flight instance.
    for (const r of normalized) {
      const existing = records.find(old => old.callsign === r.callsign && old.origin === r.origin && old.destination === r.destination && old.date === r.date && old.source === r.source);
      if (existing) Object.assign(existing, Object.fromEntries(Object.entries(r).filter(([, value]) => value !== '')));
      else records.push(r);
    }
    this.store.write('gate-history', records.filter(r => Date.parse(r.date) > Date.now() - 30 * 86400000).slice(-500));
    cache[cacheKey] = { at: Date.now(), message };
    this.store.write('gate-requests', Object.fromEntries(Object.entries(cache).filter(([, v]) => Date.now() - v.at < 86400000)));
    return { ...selectGates(records, plan), message };
  }
}
