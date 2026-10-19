import { parseOfpDetails } from './ofp.mjs';
export const normalizeRoute = value => (typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ').toUpperCase();
export const DEFAULT_RULES = [
  { id: 'swa', airline: 'SWA', aircraft: '*', costIndex: 40 },
  { id: 'dal319', airline: 'DAL', aircraft: 'A319', costIndex: 25 },
  { id: 'dal320', airline: 'DAL', aircraft: 'A320', costIndex: 25 },
  { id: 'dal321', airline: 'DAL', aircraft: 'A321', costIndex: 25 },
  { id: 'dal738', airline: 'DAL', aircraft: 'B738', costIndex: 35 },
  { id: 'dal739', airline: 'DAL', aircraft: 'B739', costIndex: 35 },
];
export const DEFAULT_SETTINGS = { simbriefId: '', autoFile: true, browser: 'auto', defaultVariants: {}, gateProvider: 'aviationstack', gateMonthlyLimit: 90, rules: DEFAULT_RULES };
export const str = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export const number = value => str(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function resolveCostIndex(airline, aircraft, rules = DEFAULT_RULES) {
  const code = airline.trim().toUpperCase();
  const type = aircraft.trim().toUpperCase();
  const exact = rules.find(r => r.airline === code && r.aircraft === type);
  const wildcard = rules.find(r => r.airline === code && r.aircraft === '*');
  return exact ?? wildcard ?? null;
}
export function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
  const simbriefId = str(input.simbriefId).trim();
  if (simbriefId && !/^[\w.@-]{1,100}$/.test(simbriefId)) throw new Error('Enter a valid SimBrief Pilot ID or username.');
  if (!['aviationstack', 'flightaware', 'none'].includes(input.gateProvider)) throw new Error('Choose a supported gate provider.');
  const gateMonthlyLimit = number(input.gateMonthlyLimit);
  if (!Number.isInteger(gateMonthlyLimit) || gateMonthlyLimit < 1 || gateMonthlyLimit > 10000) throw new Error('Monthly lookup limit must be 1–10,000.');
  if (!Array.isArray(input.rules) || input.rules.length > 200) throw new Error('Invalid cost index rules.');
  const keys = new Set();
  const rules = input.rules.map((r, i) => {
    const airline = str(r.airline).trim().toUpperCase();
    const aircraft = str(r.aircraft).trim().toUpperCase();
    const costIndex = number(r.costIndex);
    if (!/^[A-Z]{3}$/.test(airline) || !/^(\*|[A-Z0-9]{2,5})$/.test(aircraft) || !Number.isInteger(costIndex) || costIndex < 0 || costIndex > 999) throw new Error(`Check cost index rule ${i + 1}. Use a three-letter airline, aircraft code or *, and CI 0–999.`);
    if (keys.has(`${airline}/${aircraft}`)) throw new Error(`Duplicate rule: ${airline} / ${aircraft}.`);
    keys.add(`${airline}/${aircraft}`);
    return { id: str(r.id) || `rule-${i}`, airline, aircraft, costIndex };
  });
  const browser = input.browser ?? 'auto';
  if (!['auto', 'msedge', 'chrome'].includes(browser)) throw new Error('Choose Edge or Chrome for sign-in.');
  const defaultVariants = input.defaultVariants ?? {};
  if (!defaultVariants || typeof defaultVariants !== 'object' || Array.isArray(defaultVariants) || Object.keys(defaultVariants).length > 500 || Object.entries(defaultVariants).some(([base, id]) => !/^[A-Z0-9]{2,5}$/.test(base) || typeof id !== 'string' || !/^(?:[A-Z0-9]{2,5}|\d+_\d+)$/.test(id))) throw new Error('Invalid default airframe preferences.');
  return { simbriefId, autoFile: input.autoFile === true, browser, defaultVariants, gateProvider: input.gateProvider, gateMonthlyLimit, rules };
}
export function validateFlight(input, aircraftList, rules) {
  if (!input || typeof input !== 'object') throw new Error('Enter your flight details.');
  const flight = { airline: str(input.airline).trim().toUpperCase(), flightNumber: str(input.flightNumber).trim().toUpperCase(), aircraft: str(input.aircraft).toUpperCase(), origin: str(input.origin).trim().toUpperCase(), destination: str(input.destination).trim().toUpperCase(), date: str(input.date), time: str(input.time), passengerMode: input.passengerMode, passengers: number(input.passengers) };
  if (!/^[A-Z]{3}$/.test(flight.airline)) throw new Error('Callsign must be a three-letter airline code, such as SWA or DAL.');
  if (!/^[0-9][A-Z0-9]{0,3}$/.test(flight.flightNumber)) throw new Error('Flight number must start with a digit and contain 1–4 letters or digits (combined callsign: maximum 7).');
  if (!/^[A-Z0-9]{4}$/.test(flight.origin) || !/^[A-Z0-9]{4}$/.test(flight.destination)) throw new Error('Enter four-character ICAO airport codes.');
  if (flight.origin === flight.destination) throw new Error('Departure and destination must be different.');
  const aircraft = aircraftList.find(a => a.id === flight.aircraft);
  if (!aircraft) throw new Error('Choose an aircraft from the SimBrief catalog.');
  flight.variant = str(input.variant) || flight.aircraft;
  const variant = (aircraft.variants ?? []).find(v => v.id === flight.variant);
  if (!variant && flight.variant !== flight.aircraft) throw new Error('This variant is unavailable. Sync your airframes or select another variant.');
  const capacity = variant ? variant.maxPassengers : aircraft.maxPassengers;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(flight.date) || !Number.isFinite(Date.parse(flight.date + 'T00:00:00Z')) || new Date(flight.date).toISOString().slice(0, 10) !== flight.date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(flight.time)) throw new Error('Enter a valid departure date and UTC time.');
  if (!['auto', 'full', 'custom'].includes(flight.passengerMode)) throw new Error('Choose a passenger load.');
  flight.route = normalizeRoute(input.route);
  for (const [key, label, max] of [['taxiOut', 'Taxi out', 99], ['taxiIn', 'Taxi in', 99], ['extraFuel', 'Extra fuel', 500], ['altitude', 'Cruise altitude', 60000]]) {
    const raw = input[key];
    flight[key] = raw == null || raw === '' ? null : number(raw);
    if (raw != null && raw !== '' && (!Number.isInteger(flight[key]) || flight[key] < (key === 'altitude' ? 1000 : 0) || flight[key] > max || (key === 'altitude' && flight[key] % 100 !== 0))) throw new Error(`${label} must be a whole number ${key === 'altitude' ? 'from 1,000–60,000 ft in 100 ft increments' : `from 0–${max} minutes`}.`);
  }
  flight.reserve = str(input.reserve);
  if (!['', 'auto', '0', '15', '30', '35', '40', '45', '60', '75', '90'].includes(flight.reserve)) throw new Error('Choose a supported reserve time.');
  flight.alternate = str(input.alternate).trim().toUpperCase();
  if (flight.alternate && !/^[A-Z0-9]{4}$/.test(flight.alternate)) throw new Error('Alternate must be a four-character ICAO code.');
  if ((input.route != null && typeof input.route !== 'string') || flight.route.length > 2000 || (flight.route && !/^[A-Z0-9 .\/+\-]+$/.test(flight.route))) throw new Error('Use route waypoints, airways, coordinates and speed/level changes (up to 2,000 characters).');
  if (flight.passengerMode === 'full' && !Number.isInteger(capacity)) throw new Error('This variant has no published passenger capacity. Sync your airframes or choose Auto.');
  if (flight.passengerMode === 'custom' && (!Number.isInteger(flight.passengers) || flight.passengers < 0 || flight.passengers > (capacity ?? 999))) throw new Error(`Passenger count must be between 0 and ${capacity ?? 999}.`);
  const rule = resolveCostIndex(flight.airline, aircraft.icao, rules);
  if (rule && aircraft.supportsCostIndex && aircraft.maxCostIndex != null && rule.costIndex > aircraft.maxCostIndex) throw new Error(`Cost index exceeds ${aircraft.id}'s maximum of ${aircraft.maxCostIndex}. Edit the rule in Settings.`);
  return { ...flight, costIndex: aircraft.supportsCostIndex ? rule?.costIndex ?? null : null, maxPassengers: capacity, aircraftIcao: variant?.icao || aircraft.icao, variantName: variant?.name || 'Default' };
}
export function simbriefUrl(flight, staticId) {
  const date = new Date(flight.date + 'T00:00:00Z');
  const dateText = `${String(date.getUTCDate()).padStart(2, '0')}${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
  const p = new URLSearchParams({ airline: flight.airline, fltnum: flight.flightNumber, callsign: flight.airline + flight.flightNumber, type: flight.variant || flight.aircraft, orig: flight.origin, dest: flight.destination, date: dateText, deph: flight.time.slice(0, 2), depm: flight.time.slice(3), static_id: staticId, units: 'LBS', planformat: 'LIDO', find_sidstar: '1' });
  // Explicit AUTO prevents a previous custom passenger count being reused.
  p.set('pax', flight.passengerMode === 'auto' ? 'AUTO' : String(flight.passengerMode === 'full' ? flight.maxPassengers : flight.passengers));
  if (flight.route) p.set('route', flight.route);
  for (const [key, value] of Object.entries(planningParameters(flight))) p.set(key, String(value));
  if (flight.costIndex !== null) { p.set('cruise', 'CI'); p.set('civalue', String(flight.costIndex)); }
  return `https://dispatch.simbrief.com/options/custom?${p}`;
}
export function planningParameters(flight) {
  const values = {};
  for (const [key, param] of [['taxiOut', 'taxiout'], ['taxiIn', 'taxiin'], ['altitude', 'fl'], ['extraFuel', 'addedfuel']]) if (flight[key] != null && flight[key] !== '') values[param] = String(flight[key]);
  if (values.addedfuel !== undefined) values.addedfuel_units = 'min';
  if (flight.reserve) values.resvrule = flight.reserve;
  if (flight.alternate) values.altn = flight.alternate;
  return values;
}

// Edit a request, then generate a new OFP; never change the filed snapshot in place.
export function flightInputFromPlan(plan) {
  const minutes = value => value == null ? '' : String(Math.round(value / 60));
  return { airline: plan.airline, flightNumber: plan.flightNumber, aircraft: plan.aircraftBase || plan.aircraft, variant: plan.variantId || '', origin: plan.origin.icao, destination: plan.destination.icao, route: plan.requestedRoute || plan.route, date: plan.offBlock.slice(0, 10), time: plan.offBlock.slice(11, 16), passengerMode: plan.passengers == null ? 'auto' : 'custom', passengers: plan.passengers == null ? '' : String(plan.passengers), taxiOut: minutes(plan.ofp?.timing.taxiOutSeconds), taxiIn: minutes(plan.ofp?.timing.taxiInSeconds), extraFuel: '', reserve: '', altitude: String(plan.altitude), alternate: plan.alternate || '', ...plan.planningInput };
}
export function hhmm(seconds) {
  const minutes = Math.floor(Number(seconds) / 60);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 5999) throw new Error('Flight duration is missing or invalid.');
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;
}
export function parseOFP(data) {
  if (!data || (data.fetch?.status && data.fetch.status !== 'Success')) throw new Error(str(data?.fetch?.status) || 'SimBrief returned no flight plan.');
  const g = data.general ?? {}, atc = data.atc ?? {}, times = data.times ?? {}, params = data.params ?? {};
  const airport = a => ({ icao: str(a?.icao_code), iata: str(a?.iata_code), name: str(a?.name), elevation: number(a?.elevation), lat: number(a?.pos_lat), lon: number(a?.pos_long), runway: str(a?.plan_rwy), metar: str(a?.metar), metarTime: str(a?.metar_time), category: str(a?.metar_category).toUpperCase() });
  const callsign = str(atc.callsign) || str(g.icao_airline) + str(g.flight_number);
  const raw = str(atc.flightplan_text);
  const origin = airport(data.origin), destination = airport(data.destination);
  if (!/^[A-Z0-9]{2,7}$/.test(callsign) || !/^[A-Z0-9]{4}$/.test(origin.icao) || !/^[A-Z0-9]{4}$/.test(destination.icao) || !raw.startsWith('(FPL-')) throw new Error('The SimBrief plan is incomplete or has an invalid callsign.');
  const altitude = number(g.initial_altitude);
  const offBlock = number(times.est_out) ?? number(times.sched_out);
  const generated = number(params.time_generated);
  if (!altitude || !offBlock || !generated || !number(times.est_time_enroute) || !number(times.endurance)) throw new Error('The plan is missing altitude, date, or duration data.');
  const wake = raw.match(/-([A-Z0-9]{2,4})\/([LMHJ])-/)?.[2] ?? 'M';
  const ofpUrl = `https://dispatch.simbrief.com/briefing/${encodeURIComponent(str(params.request_id))}`;
  return {
    id: str(params.request_id) || String(generated), staticId: str(params.static_id), generatedAt: new Date(generated * 1000).toISOString(),
    callsign, airline: str(g.icao_airline), flightNumber: str(g.flight_number), aircraft: str(data.aircraft?.icaocode), aircraftName: str(data.aircraft?.name), aircraftBase: str(data.aircraft?.base_type), registration: str(data.aircraft?.reg),
    origin, destination, alternate: str(Array.isArray(data.alternate) ? data.alternate[0]?.icao_code : data.alternate?.icao_code),
    altitude, speed: number(g.cruise_tas) ?? number(atc.initial_spd), costIndex: number(g.costindex), passengers: number(g.passengers), distance: number(g.route_distance),
    route: str(g.route), raw, wake, enroute: hhmm(times.est_time_enroute), endurance: hhmm(times.endurance), offBlock: new Date(offBlock * 1000).toISOString(),
    blockFuel: number(data.fuel?.plan_ramp), units: str(params.units).toUpperCase(), ofpUrl, ofp: parseOfpDetails(data), filing: { status: 'not-filed', message: 'Not filed on VATSIM.' },
  };
}
export function matchGeneratedPlan(plan, flight, startedAt, previousId, staticId) {
  const departure = Date.parse(flight.date + 'T' + flight.time + ':00Z');
  return plan.id !== previousId && Date.parse(plan.generatedAt) >= startedAt - 5000 &&
    (!plan.staticId || plan.staticId === staticId) && plan.callsign === flight.airline + flight.flightNumber &&
    plan.origin.icao === flight.origin && plan.destination.icao === flight.destination &&
    (plan.aircraft === flight.aircraftIcao || plan.aircraftBase === flight.aircraft) && Math.abs(Date.parse(plan.offBlock) - departure) < 60000 &&
    (flight.costIndex === null || plan.costIndex === flight.costIndex) &&
    (flight.passengerMode === 'auto' || plan.passengers === (flight.passengerMode === 'full' ? flight.maxPassengers : flight.passengers));
}
export function vatsimFields(plan) {
  if (!Number.isFinite(plan.speed) || plan.speed <= 0) throw new Error('SimBrief did not return an airspeed.');
  return { callsign: plan.callsign, rules: 'IFR', aircraft: plan.aircraft, wake: plan.wake, equipment: 'L', transponder: '', departure: plan.origin.icao, arrival: plan.destination.icao, alternate: plan.alternate, offBlock: plan.offBlock.slice(11, 16).replace(':', ''), altitude: String(plan.altitude), speed: String(plan.speed), enroute: plan.enroute, endurance: plan.endurance, route: plan.route.replace(/\bDCT\b/g, '').replace(/\s+/g, ' ').trim(), voice: 'Voice' };
}
export function vatsimUrl(plan) {
  const f = vatsimFields(plan);
  // The screenshot leaves every section-18 field blank. Use 0, retain the
  // generated flight numbers, and force FAA /L with no transponder suffix.
  const raw = `(FPL-${f.callsign}-IS\n-${f.aircraft}/${f.wake}-L/\n-${f.departure}${f.offBlock}\n-N${f.speed.padStart(4, '0')}F${String(Math.round(plan.altitude / 100)).padStart(3, '0')} ${f.route}\n-${f.arrival}${f.enroute}${f.alternate ? ' ' + f.alternate : ''}\n-0)`;
  return `https://my.vatsim.net/pilots/flightplan?${new URLSearchParams({ raw, fuel_time: f.endurance })}`;
}
export function selectGates(records, plan, now = Date.now()) {
  const date = plan.offBlock.slice(0, 10);
  const candidates = records.filter(r => r.callsign === plan.callsign && r.origin === plan.origin.icao && r.destination === plan.destination.icao && r.date && (r.departureGate || r.arrivalGate) && Date.parse(r.date) <= now + 86400000);
  const current = candidates.filter(r => r.date.slice(0, 10) === date).sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(plan.offBlock)) - Math.abs(Date.parse(b.date) - Date.parse(plan.offBlock)));
  const history = candidates.filter(r => r.date.slice(0, 10) < date && Date.parse(r.date) >= now - 30 * 86400000).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const choose = field => {
    const match = current.find(r => r[field]) ?? history.find(r => r[field]);
    return match ? { value: match[field], terminal: field === 'departureGate' ? match.departureTerminal : match.arrivalTerminal, date: match.date, historical: match.date.slice(0, 10) !== date, source: match.source, fetchedAt: match.fetchedAt } : null;
  };
  return { departure: choose('departureGate'), arrival: choose('arrivalGate') };
}
