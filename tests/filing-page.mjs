// Local service fixture for the desktop smoke test. No VATSIM request is sent.
export function filingPage(expected) {
  const labels = { callsign: 'Callsign', rules: 'Flight Rules', aircraft: 'Aircraft Type (ICAO)', wake: 'Wake Category', equipment: 'Equipment (ICAO/FAA)', transponder: 'Transponder (Skip if FAA Equip)', departure: 'Departure', arrival: 'Arrival', alternate: 'Alternate', offBlock: 'Off Block UTC (HHMM)', altitude: 'Altitude (ft)', speed: 'Airspeed (knots)', enroute: 'Enroute Time (HHMM)', endurance: 'Fuel Endurance (HHMM)', route: 'Route Details', voice: 'Voice Rules' };
  const escape = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let html = '<!doctype html><title>Local VATSIM test form</title><form>';
  for (const [key, label] of Object.entries(labels)) {
    html += `<label for="${key}">${label}</label>`;
    if (key === 'route') html += `<textarea id="${key}">WRONG ROUTE</textarea>`;
    else if (['rules', 'wake', 'voice'].includes(key)) html += `<select id="${key}"><option>${escape(expected[key])}</option></select>`;
    else html += `<input id="${key}" value="${escape(['callsign', 'departure', 'arrival'].includes(key) ? expected[key] : 'WRONG')}">`;
  }
  html += '<label for="rmk">RMK/</label><input id="rmk" value="TO CLEAR"><button type="button">File Plan (FPL)</button></form><div role="alert"></div>';
  html += `<script>const expected=${JSON.stringify(expected)};let clicks=0;document.querySelector('button').addEventListener('click',()=>{clicks++;const valid=Object.entries(expected).every(([key,value])=>document.getElementById(key).value===value)&&document.getElementById('rmk').value===''&&clicks===1;document.querySelector('[role="alert"]').textContent=valid?'Flight plan successfully filed. Local test only.':'Error: incorrect field or duplicate submission';});</script>`;
  return html;
}
