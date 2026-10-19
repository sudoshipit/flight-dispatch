const num = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
export function normalizeAircraft(types, airframes) {
  return Object.values(types.aircraft ?? {}).map(type => {
    const details = airframes[type.id] ?? {};
    const variants = (details.airframes ?? []).filter(a => /^[A-Z0-9]{2,5}$|^\d+_\d+$/.test(a.airframe_internal_id)).map(a => ({
      id: a.airframe_internal_id, name: a.airframe_comments || a.airframe_name || a.airframe_internal_id,
      icao: a.airframe_icao || details.aircraft_icao || type.id, registration: a.airframe_registration || '',
      maxPassengers: num(a.airframe_passengers), source: 'SimBrief',
    }));
    return { id: type.id, name: type.name, icao: details.aircraft_icao || type.id, maxPassengers: num(details.aircraft_passengers), maxCostIndex: num(details.aircraft_max_costindex), supportsCostIndex: Boolean(type.costindex_data), variants };
  }).filter(a => a.id && a.name);
}
export function mergePersonalAirframes(catalog, personal = {}) {
  return { ...catalog, aircraft: catalog.aircraft.map(a => ({ ...a, variants: [...(a.variants ?? []).filter(v => !(personal[a.id] ?? []).some(p => p.id === v.id)), ...(personal[a.id] ?? [])] })) };
}
