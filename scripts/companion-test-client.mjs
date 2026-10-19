import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

// Real MV3 worker and browser APIs, isolated profile, all service HTTP requests
// intercepted locally. No real account, security challenge or flight is touched.
export async function launchTestCompanion(userData, handleRoute) {
  const extension = path.join(userData, 'vatsim-companion');
  const channel = process.env.FLIGHT_DISPATCH_TEST_BROWSER || 'chromium';
  // Tabs created by a service worker can navigate before Playwright attaches.
  // Resolve VATSIM to this local HTTPS fixture and block all other DNS, ensuring
  // even the first navigation never reaches a live service.
  const server = https.createServer({ key: fs.readFileSync(new URL('../tests/https/local-test.key', import.meta.url)), cert: fs.readFileSync(new URL('../tests/https/local-test.crt', import.meta.url)) }, (request, response) => {
    void Promise.resolve(handleRoute({ request: () => ({ url: () => `https://${request.headers.host}${request.url}` }), fulfill: async ({ status = 200, contentType = 'text/plain', body = '' }) => { response.writeHead(status, { 'Content-Type': contentType }); response.end(body); } })).catch(error => { response.writeHead(500); response.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let context;
  try {
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-extension-test-')), {
      channel, headless: true, ignoreDefaultArgs: ['--disable-extensions'],
      args: [ '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP my.vatsim.net 127.0.0.1:${port}, MAP auth.vatsim.net 127.0.0.1:${port}, MAP connect.vatsim.net 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost`, ...(channel === 'chromium' ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] : ['--enable-unsafe-extension-debugging']) ],
    });
    // Installed browsers can load the test extension through their documented
    // extension testing protocol. This is never used in production profiles.
    if (channel !== 'chromium') {
      const session = await context.browser().newBrowserCDPSession();
      await session.send('Extensions.loadUnpacked', { path: extension });
      await session.detach();
    }
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    return { context, worker, close: async () => { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { await context?.close(); server.closeAllConnections(); server.close(); throw error; }
}
