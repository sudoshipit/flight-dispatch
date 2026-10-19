import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { vatsimPageStep, simbriefPageStep } from '../electron/automation.mjs';
import { vatsimFields, parseOFP } from '../shared/domain.mjs';
import { ofp } from './fixtures.mjs';

function page(html, url = 'https://my.vatsim.net/pilots/flightplan') {
  const dom = new JSDOM(html, { url, runScripts:'outside-only' });
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width:100,height:30 }];
  return dom;
}
function form() {
  const labels = { callsign:'Callsign',rules:'Flight Rules',aircraft:'Aircraft Type (ICAO)',wake:'Wake Category',equipment:'Equipment (ICAO/FAA)',transponder:'Transponder (Skip if FAA Equip)',departure:'Departure',arrival:'Arrival',alternate:'Alternate',offBlock:'Off Block UTC (HHMM)',altitude:'Altitude (ft)',speed:'Airspeed (knots)',enroute:'Enroute Time (HHMM)',endurance:'Fuel Endurance (HHMM)',route:'Route Details',voice:'Voice Rules' };
  const expected = vatsimFields(parseOFP(ofp));
  let html = '<form>';
  for (const [key,label] of Object.entries(labels)) {
    html += `<label for="${key}">* ${label}</label>`;
    if (key === 'rules') html += '<select id="rules"><option value="I">IFR</option></select>';
    else if (key === 'wake') html += '<select id="wake"><option value="M">Medium (MTOW &lt;= 136,000 kg)</option></select>';
    else if (key === 'voice') html += '<select id="voice"><option value="v">Voice</option></select>';
    else if (key === 'route') html += `<textarea id="${key}" name="route">old route</textarea>`;
    else html += `<input id="${key}" value="${key === 'equipment' ? 'SDFGRW' : key === 'transponder' ? 'LB1' : expected[key]}">`;
  }
  html += '<label for="pbn">PBN/</label><input id="pbn" value="A1B1"><button type="button">File Plan (FPL)</button></form><div class="alert-success"></div>';
  return { dom:page(html), expected };
}
const execute = (dom, fn, args) => dom.window.eval(`(${fn.toString()})(...${JSON.stringify(args)})`);
test('VATSIM fills exact fields, clears overrides, submits once, and waits for success', () => {
  const {dom,expected} = form(); let clicks=0;
  dom.window.document.querySelector('button').addEventListener('click',()=>clicks++);
  assert.equal(execute(dom,vatsimPageStep,[expected,true,false]).state,'submitted');
  assert.equal(dom.window.document.querySelector('#equipment').value,'L'); assert.equal(dom.window.document.querySelector('#transponder').value,''); assert.equal(dom.window.document.querySelector('#pbn').value,'');
  assert.equal(execute(dom,vatsimPageStep,[expected,true,true]).state,'submitted'); assert.equal(clicks,1);
  dom.window.document.querySelector('.alert-success').textContent='Flight plan successfully filed. Happy flying!';
  assert.equal(execute(dom,vatsimPageStep,[expected,true,true]).state,'confirmed'); assert.equal(clicks,1);
});
test('no submission when account form differs, controls are missing, or manual mode is selected', () => {
  for (const mode of ['different','missing','manual']) {
    const {dom,expected} = form(); let clicks=0; dom.window.document.querySelector('button').addEventListener('click',()=>clicks++);
    if(mode==='different')dom.window.document.querySelector('#callsign').value='DAL42';
    if(mode==='missing')dom.window.document.querySelector('#transponder').remove();
    const result=execute(dom,vatsimPageStep,[expected,mode!=='manual',false]); assert.notEqual(result.state,'submitted');assert.equal(clicks,0);
  }
});
test('stale success message does not mark a plan filed before submission', () => {
  const {dom,expected}=form();dom.window.document.querySelector('.alert-success').textContent='Flight plan successfully filed';
  assert.notEqual(execute(dom,vatsimPageStep,[expected,false,false]).state,'confirmed');
  assert.equal(execute(dom,vatsimPageStep,[expected,true,false]).state,'submitted');
  assert.notEqual(execute(dom,vatsimPageStep,[expected,true,true,'Flight plan successfully filed']).state,'confirmed');
});

test('plain filed confirmation is accepted, but negative filing messages are not', () => {
  for (const message of ['Flight plan filed.', 'Flight plan not filed.', 'Flight plan filing unsuccessful.', 'Flight plan cannot be filed.']) {
    const {dom,expected}=form();
    execute(dom,vatsimPageStep,[expected,true,false]);
    dom.window.document.querySelector('.alert-success').textContent=message;
    assert.equal(execute(dom,vatsimPageStep,[expected,false,true]).state==='confirmed',message==='Flight plan filed.');
  }
});
test('page outside approved service is not touched', () => {
  const dom=page('<button>File Plan (FPL)</button>','https://example.com/pilots/flightplan');
  assert.equal(execute(dom,vatsimPageStep,[{},true,false]).state,'waiting');
});
test('SimBrief waits for requested inputs and generates only once', () => {
  const dom=page('<input name="airline" value="SWA"><input name="fltnum" value="123"><button>Generate Flight</button>','https://dispatch.simbrief.com/options/custom');let clicks=0;
  dom.window.document.querySelector('button').addEventListener('click',()=>clicks++);
  assert.equal(execute(dom,simbriefPageStep,[{airline:'DAL',fltnum:'123'}]).state,'waiting');assert.equal(clicks,0);
  assert.equal(execute(dom,simbriefPageStep,[{airline:'SWA',fltnum:'123'}]).state,'submitted');execute(dom,simbriefPageStep,[{airline:'SWA',fltnum:'123'}]);assert.equal(clicks,1);
});
test('SimBrief does not generate until the supplied custom route is loaded', () => {
  const dom=page('<textarea name="route">DCT WRONG</textarea><button>Generate Flight</button>','https://dispatch.simbrief.com/options/custom'); let clicks=0;
  dom.window.document.querySelector('button').addEventListener('click',()=>clicks++);
  assert.equal(execute(dom,simbriefPageStep,[{route:'CAMJO Q99 HEPAR'}]).state,'waiting'); assert.equal(clicks,0);
  dom.window.document.querySelector('textarea').value='camjo\nQ99  HEPAR';
  assert.equal(execute(dom,simbriefPageStep,[{route:'CAMJO Q99 HEPAR'}]).state,'submitted'); assert.equal(clicks,1);
});
