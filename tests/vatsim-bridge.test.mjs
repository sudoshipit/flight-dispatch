import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { VatsimBridge } from '../electron/vatsim-bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function bridge(t) {
  const value = new VatsimBridge(root, fs.mkdtempSync(path.join(os.tmpdir(), 'flight-dispatch-bridge-')), { port: 0 });
  await value.start(); t.after(() => value.close()); return value;
}
async function client(bridge, token = bridge.token) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/vatsim`, { origin: `chrome-extension://${bridge.id}` });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'hello', token, version: bridge.version }));
  return socket;
}
test('companion pairs locally without exposing its secret through public status', async t => {
  const value = await bridge(t);
  const socket = await client(value);
  assert.equal(JSON.parse((await once(socket, 'message'))[0]).type, 'ready');
  assert.equal(value.status().connected, true);
  assert.ok(!JSON.stringify(value.status()).includes(value.token));
  const config = fs.readFileSync(path.join(value.folder, 'config.mjs'), 'utf8');
  assert.ok(config.includes(`127.0.0.1:${value.port}`));
  const pending = value.request('state', { tabId: 1 });
  const command = JSON.parse((await once(socket, 'message'))[0]);
  socket.send(JSON.stringify({ type: 'result', id: command.id, result: { state: 'ready' } }));
  assert.deepEqual(await pending, { state: 'ready' });
});
test('wrong tokens and website origins cannot control or read the VATSIM bridge', async t => {
  const value = await bridge(t);
  const wrong = await client(value, '0'.repeat(64));
  assert.equal((await once(wrong, 'close'))[0], 1008);
  assert.equal(value.connected(), false);
  const website = new WebSocket(`ws://127.0.0.1:${value.port}/vatsim`, { origin: 'https://my.vatsim.net' });
  const [error] = await once(website, 'error');
  assert.match(error.message, /401/);
});
test('disconnect rejects an in-flight submission and never resends it on reconnect', async t => {
  const value = await bridge(t);
  const socket = await client(value); await once(socket, 'message');
  const result = value.request('step', { allowSubmit: true });
  const rejected = assert.rejects(result, /will not be repeated/);
  const sent = JSON.parse((await once(socket, 'message'))[0]);
  assert.equal(sent.args.allowSubmit, true);
  socket.terminate(); await rejected;
  const next = await client(value); await once(next, 'message');
  assert.equal(value.pending.size, 0);
});
test('missing companion is a setup error, not an authentication prompt', async t => {
  const value = await bridge(t), messages = [];
  await assert.rejects(value.waitForConnection({ timeout: 0, onWaiting: message => messages.push(message) }), /not connected/);
  assert.match(messages[0], /companion/);
  assert.doesNotMatch(messages[0], /sign in again/i);
});
