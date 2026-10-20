export function userMessage(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    .replace(/^(?:page\.\w+:\s*)?(?:Error:\s*)?/, '')
    .split(/\n\s*(?:at |Call log:)/)[0].trim() || 'Something went wrong. Please try again.';
}

export function briefingText(plan, details) {
  const value = number => number == null ? 'None' : Number(number).toLocaleString('en-US');
  const utc = date => date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString().replace('T', ' ').replace('.000Z', 'Z') : 'None';
  const procedure = p => p ? `${p.name || 'None'} · transition ${p.transition || 'None'} · runway ${p.runway || 'None'}` : 'None';
  const gate = g => g ? `${g.value}${g.terminal ? ` · terminal ${g.terminal}` : ''} · ${g.historical ? 'historical suggestion' : 'reported assignment'} · ${g.source} · flight ${utc(g.date)}` : 'Unavailable';
  const frequencies = airport => details?.airports?.[airport]?.frequencies.map(f => f.frequency).join(' / ') || 'Unavailable';
  const weather = airport => {
    const w = details?.weather?.[airport.icao];
    return `${airport.icao} METAR (${w?.source || 'SimBrief snapshot'}${w?.stale ? ' · stale' : ''}, observed ${utc(w?.observedAt || airport.metarTime)}): ${w?.raw || airport.metar || 'Unavailable'}`;
  };
  return [
    `${plan.callsign} · ${plan.aircraft} · ${plan.registration || 'None'}`,
    `${plan.origin.icao} ${plan.origin.name} → ${plan.destination.icao} ${plan.destination.name}`,
    `Planned off blocks ${utc(plan.ofp?.timing?.out?.estimated || plan.offBlock)}`,
    `Planned on block ${utc(plan.ofp?.timing?.in?.estimated || plan.ofp?.timing?.in?.scheduled)}`,
    `Cruise FL${Math.round(plan.altitude / 100)} · CI ${value(plan.costIndex)} · passengers ${value(plan.passengers)}`,
    `Planned fuel (${plan.units}): block ${value(plan.blockFuel)} · takeoff ${value(plan.ofp?.fuel?.takeoff)} · landing ${value(plan.ofp?.fuel?.landing)}`,
    `SID ${procedure(plan.ofp?.procedures?.departure)}`,
    `STAR ${procedure(plan.ofp?.procedures?.arrival)}`,
    `Alternate ${plan.alternate || 'None'} · destination elevation ${value(details?.airports?.[plan.destination.icao]?.elevation ?? plan.destination.elevation)} ft MSL`,
    `VATSIM CTAF: ${plan.origin.icao} ${frequencies(plan.origin.icao)} · ${plan.destination.icao} ${frequencies(plan.destination.icao)}`,
    `Departure gate: ${gate(details?.gates?.departure)}`,
    `Arrival gate: ${gate(details?.gates?.arrival)}`,
    `Route: ${plan.route || 'None'}`,
    weather(plan.origin), weather(plan.destination),
    `SimBrief: ${plan.ofpUrl}`,
  ].join('\n');
}

export function flightHistoryView(flights, { search = '', filter = 'all', sort = 'saved', now = Date.now() } = {}) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const complete = flight => flight.actual?.phase === 'complete' || !!flight.landing?.completedAt;
  return flights.filter(flight => {
    const text = [flight.callsign, flight.aircraft, flight.registration, flight.origin.icao, flight.origin.name, flight.destination.icao, flight.destination.name].join(' ').toLowerCase();
    if (!terms.every(term => text.includes(term))) return false;
    if (filter === 'upcoming') return !complete(flight) && !flight.actual?.out && !['taxi-out','airborne','taxi-in'].includes(flight.actual?.phase) && Date.parse(flight.offBlock) >= now;
    if (filter === 'complete') return complete(flight);
    if (filter === 'attention') return ['failed','unconfirmed'].includes(flight.filing.status);
    return true;
  }).sort((a, b) => sort === 'departure' ? Date.parse(a.offBlock) - Date.parse(b.offBlock) : 0);
}
