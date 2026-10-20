import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readSimbriefFlights, readSimbriefXmlLink, parseSimbriefXml, isSimbriefXmlUrl } from '../electron/simbrief-import.mjs';
import { parseOFP } from '../shared/domain.mjs';
import { ofp } from './fixtures.mjs';

export const toXml = (value, key = 'OFP') => Array.isArray(value) ? value.map(v => toXml(v, key)).join('') : `<${key}>${value && typeof value === 'object' ? Object.entries(value).map(([k,v]) => toXml(v,k)).join('') : String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</${key}>`;
const run = (html, fn, ...args) => {
  const dom = new JSDOM(html, { url: 'https://dispatch.simbrief.com/flights/all', runScripts: 'outside-only' });
  try { return dom.window.eval(`(${fn.toString()})`)(...args); } finally { dom.window.close(); }
};
const row = (id, time) => `<div class="row-item"><span data-key="flight_number">SWA123</span><span data-key="origin_icao">KTPA</span><span data-key="destination_icao">KBUF</span><span class="sort-value" data-key="departure_time">${time}</span><span class="sort-value" data-key="generated_time">${time}</span><a data-key="request_id" href="./briefing/${id}">View</a></div>`;
test('saved flight reader includes older releases and UTC departures, deduplicates and orders newest first', () => {
  const flights = run(`<main id="flights"><div id="flights-history">${row('old','2026-12-31T23:50:00')}${row('later','2027-01-01T01:00:00')}${row('old','2026-12-31T23:50:00')}</div></main>`, readSimbriefFlights);
  assert.equal(flights.length,2); assert.equal(flights[0].id,'later'); assert.equal(flights[0].offBlock,'2027-01-01T01:00:00.000Z');
  assert.equal(run('<main/>',readSimbriefFlights),null);
  assert.equal(run('<main id="flights"><div id="flights-history"></div></main>',readSimbriefFlights).length,0);
  assert.throws(()=>run(`<main id="flights"><div id="flights-history">${row('../../bad','2027-01-01T00:00:00')}</div></main>`,readSimbriefFlights),/format changed/);
});
test('archived XML preserves full OFP details and rejects malformed or entity-bearing files', () => {
  assert.deepEqual(parseOFP(JSON.parse(JSON.stringify(run('',parseSimbriefXml,toXml(ofp))))),parseOFP(ofp));
  for(const bad of ['<!DOCTYPE OFP><OFP/>','<OFP><broken></OFP>','<html/>']) assert.throws(()=>run('',parseSimbriefXml,bad),/invalid/i);
});
test('expired OFPs with disabled View links do not prevent importing available history', () => {
  const expired = '<div class="row-item row-parent"><a class="disabled" data-key="request_id" data-disable="xml_link">View</a><a data-key="request_id" href="./options/123">Edit</a></div>';
  const html = `<main id="flights"><div id="flights-history">${expired}${row('available','2027-01-01T01:00:00')}</div></main>`;
  const flights = run(html,readSimbriefFlights);
  assert.equal(flights.length,1); assert.equal(flights[0].id,'available');
  assert.equal(run(`<main id="flights"><div id="flights-history">${expired}</div></main>`,readSimbriefFlights).length,0);
});
test('only SimBrief XML downloads are permitted and export links are read from the selected briefing', () => {
  const url='https://www.simbrief.com/ofp/flightplans/xml/test-123.xml';
  assert.equal(isSimbriefXmlUrl(url),true);
  for(const bad of [url.replace('www.simbrief.com','evil.test'),url.replace('https:','http:'),url+'?redirect=x',url.replace('/ofp/','/other/'),'file:///tmp/test.xml']) assert.equal(isSimbriefXmlUrl(bad),false);
  assert.equal(run(`<main id="briefing"><a href="${url}">XML Datafile</a></main>`,readSimbriefXmlLink),url);
});
