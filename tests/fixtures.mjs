import detail from './ofp-details.json' with { type: 'json' };
export const ofp = {
  fetch: { status: 'Success' }, params: { request_id: 'test-123', time_generated: '1792417254', units: 'lbs', airac: detail.airac },
  general: { ...detail.general, icao_airline: 'SWA', flight_number: '123', initial_altitude: '37000', cruise_tas: '460', costindex: '40', passengers: '132', route_distance: '959', route: 'BAYPO2 CAMJO Q99 HEPAR DCT IRQ DCT BURGG DCT HVQ Q145 FOXEE DCT DKK DCT' },
  origin: { icao_code: 'KTPA', iata_code: 'TPA', name: 'TAMPA INTL', elevation: '27', pos_lat: '27.975', pos_long: '-82.533', plan_rwy: '01R', metar: 'KTPA 191253Z 02009G17KT 10SM FEW040 SCT065 19/15 A3017', metar_time: '2026-10-19T12:53:00Z', metar_category: 'vfr' },
  destination: { icao_code: 'KBUF', iata_code: 'BUF', name: 'BUFFALO NIAGARA INTL', elevation: '728', pos_lat: '42.94', pos_long: '-78.73', plan_rwy: '23', metar: 'KBUF 191254Z 21008KT 10SM FEW025 BKN055 10/05 A3005', metar_time: '2026-10-19T12:54:00Z', metar_category: 'vfr' },
  alternate: { icao_code: 'KROC' }, aircraft: { icaocode: 'B737', name: 'B737-700', base_type: 'B737', reg: 'N123FD' },
  atc: { callsign: 'SWA123', flightplan_text: '(FPL-SWA123-IS\n-B737/M-SDE2E3FGHIRWXY/LB1\n-KTPA1415\n-N0460F370 BAYPO2 CAMJO Q99 HEPAR IRQ BURGG HVQ Q145 FOXEE DKK\n-KBUF0227 KROC\n-PBN/A1B1C1D1S1S2 DOF/261019 REG/N123FD RMK/TCAS)' },
  times: detail.times, fuel: detail.fuel, weights: detail.weights, navlog: detail.navlog,
};
export const aircraft = [
  { id: 'B737', icao: 'B737', name: 'B737-700', maxPassengers: 149, maxCostIndex: 500, supportsCostIndex: true },
  { id: 'A320', icao: 'A320', name: 'A320-200', maxPassengers: 180, maxCostIndex: 999, supportsCostIndex: true },
  { id: 'B738', icao: 'B738', name: 'B737-800', maxPassengers: 184, maxCostIndex: 500, supportsCostIndex: true },
  { id: 'C172', icao: 'C172', name: 'Cessna 172', maxPassengers: 3, maxCostIndex: null, supportsCostIndex: false },
];
export const input = { airline: 'SWA', flightNumber: '123', aircraft: 'B737', origin: 'KTPA', destination: 'KBUF', date: '2026-10-19', time: '14:15', passengerMode: 'auto', passengers: '' };
