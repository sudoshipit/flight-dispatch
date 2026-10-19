import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserSessions } from '../electron/browser.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-browser-'));
const browser = new BrowserSessions(directory);
const create = browser.createContext.bind(browser);
browser.createContext = async () => {
  const context = await create();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Test airframes</title>
    <select id="basetype"><option>B737</option></select>
    <select name="type" onchange="document.querySelector('[name=pax]').max=this.selectedOptions[0].dataset.capacity">
      <option value="B737" data-capacity="149">Default</option>
      <option value="900000000_100" data-type="user" data-basetype="B737" data-icao="B737" data-registration="N128FD" data-capacity="128">PMDG PAX 128 BASE WEIGHT</option>
      <option value="900000000_101" data-type="user" data-basetype="B737" data-icao="B737" data-registration="N148FD" data-capacity="148">PMDG PAX 148 BASE WEIGHT</option>
      <option value="900000000_102" data-type="user" data-basetype="B737" data-icao="B737" data-capacity="0">Cargo</option>
    </select><input name="pax" max="149"><script>document.cookie='testSession=present; Max-Age=3600; Secure; SameSite=Lax';</script>` }));
  return context;
};
try {
  const tab = await browser.open('simbrief', 'https://dispatch.simbrief.com/options/custom?type=B737');
  const variants = await tab.readAirframes('B737');
  assert.deepEqual(variants.map(v => v.maxPassengers), [128,148,0]);
  assert.equal(variants[0].registration, 'N128FD');
  assert.equal(await tab.readAirframes('A320'), null);
  assert.equal(await tab.needsLogin(), false);
  await tab.page.setContent('<title>SimBrief Dispatch</title><div id="login"><a id="login-button">Sign In</a></div>');
  assert.equal(await tab.needsLogin(), true, 'SimBrief login overlay at the unchanged options URL prompts for authentication');
  await tab.page.locator('#login').evaluate(el => el.style.display = 'none');
  assert.equal(await tab.needsLogin(), false, 'A hidden login overlay does not interrupt an authenticated page');
  await tab.page.setContent('<title>Just a moment...</title><h1>Verify you are human</h1>');
  assert.equal(await tab.needsLogin(), true);
  await tab.page.setContent('<title>Account</title><input type="password">');
  assert.equal(await tab.needsLogin(), true);
  await browser.close();
  const context = await browser.ensure();
  // Only the isolated test cookie is inspected; no user's real session is accessed.
  assert.equal((await context.cookies()).find(c => c.name === 'testSession')?.value, 'present');
  console.log('Native browser test passed: visible login overlays, password pages and challenges prompt for auth; hidden login controls do not. Also verified personal airframe capacities and persistent sessions across background restarts.');
} finally { await browser.close(); }
