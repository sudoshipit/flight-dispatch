// These readers run in the existing signed-in SimBrief page. Only rendered
// flight metadata and the selected briefing's XML download are read.
export function readSimbriefFlights() {
  const list = document.querySelector('main#flights #flights-history');
  if (!list) return null;
  const rows = [...list.querySelectorAll('.row-item:not(.row-empty)')];
  const flights = rows.map(row => {
    const field = key => row.querySelector(`[data-key="${key}"]`)?.textContent.trim() || '';
    const timestamp = key => {
      const text = row.querySelector(`.sort-value[data-key="${key}"]`)?.textContent.trim();
      const ms = text && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(text) ? Date.parse(text + 'Z') : NaN;
      return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
    };
    const link = row.querySelector('a[data-key="request_id"][href*="briefing/"]');
    const id = link?.getAttribute('href')?.match(/\/briefing\/([A-Za-z0-9_-]{1,100})$/)?.[1];
    return id ? { id, callsign: field('flight_number'), origin: field('origin_icao'), destination: field('destination_icao'),
      aircraft: field('aircraft_icao'), registration: field('aircraft_registration'), offBlock: timestamp('departure_time'),
      generatedAt: timestamp('generated_time'), release: field('release_number') } : null;
  }).filter(Boolean);
  // A changed page must not masquerade as an empty account.
  if (rows.length && flights.length !== rows.length) throw new Error('SimBrief’s flight list format changed. Use Import latest or try again after updating Flight Dispatch.');
  return [...new Map(flights.map(flight => [flight.id, flight])).values()]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function readSimbriefXmlLink() {
  if (!document.querySelector('main#briefing')) return null;
  const link = [...document.querySelectorAll('main#briefing a[href]')].find(a => /\/xml\/[^/?]+\.xml(?:\?|$)/i.test(a.getAttribute('href') || ''));
  if (link) return link.href;
  if (document.querySelector('main#briefing #briefing-error, main#briefing .page-alert.error')) {
    throw new Error('This SimBrief OFP is no longer available. Generate it in SimBrief, then import again.');
  }
  return null;
}

export function isSimbriefXmlUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.simbrief.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /^\/ofp\/flightplans\/xml\/[A-Za-z0-9_.-]+\.xml$/.test(url.pathname);
  } catch { return false; }
}

// DOMParser does not execute XML. Reject DTDs/entities and malformed documents;
// preserve repeated elements exactly as the existing JSON OFP parser expects.
export function parseSimbriefXml(xml) {
  if (typeof xml !== 'string' || xml.length > 25_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid SimBrief XML data.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement?.tagName !== 'OFP') throw new Error('SimBrief returned an invalid XML flight plan.');
  const convert = (element, depth = 0) => {
    if (depth > 64) throw new Error('SimBrief XML is too deeply nested.');
    if (!element.children.length) return element.textContent.trim();
    const result = Object.create(null);
    for (const child of element.children) {
      const value = convert(child, depth + 1), key = child.tagName;
      if (Object.hasOwn(result, key)) result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
      else result[key] = value;
    }
    return result;
  };
  return convert(doc.documentElement);
}
