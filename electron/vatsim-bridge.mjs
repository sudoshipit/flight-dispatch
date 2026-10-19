import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

export const COMPANION_PORT = 49773;
export function extensionId(key) {
  return crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
}
const sameSecret = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class VatsimBridge {
  constructor(root, directory, { port = COMPANION_PORT } = {}) {
    this.root = root;
    this.directory = directory;
    this.folder = path.join(directory, 'vatsim-companion');
    this.port = port;
    this.socket = null;
    this.pending = new Map();
    this.error = '';
  }
  prepare() {
    fs.mkdirSync(this.folder, { recursive: true });
    const configPath = path.join(this.directory, 'vatsim-companion-connection.json');
    let config;
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* First setup. */ }
    if (!/^[a-f0-9]{64}$/.test(config?.token || '')) {
      config = { token: crypto.randomBytes(32).toString('hex') };
      fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    }
    this.token = config.token;
    const source = path.join(this.root, 'companion');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    this.id = extensionId(manifest.key);
    this.version = manifest.version;
    for (const file of ['manifest.json', 'worker.mjs', 'popup.html', 'popup.js', 'page-state.mjs']) fs.copyFileSync(path.join(source, file), path.join(this.folder, file));
    fs.copyFileSync(path.join(this.root, 'electron', 'automation.mjs'), path.join(this.folder, 'automation.mjs'));
    fs.writeFileSync(path.join(this.folder, 'config.mjs'), `export const CONFIG = ${JSON.stringify({ url: `ws://127.0.0.1:${this.port}/vatsim`, token: this.token, version: this.version })};\n`, { mode: 0o600 });
  }
  async start() {
    this.prepare();
    this.server = new WebSocketServer({ host: '127.0.0.1', port: this.port, path: '/vatsim', maxPayload: 128 * 1024, verifyClient: ({ origin }) => origin === `chrome-extension://${this.id}` });
    await new Promise((resolve, reject) => { this.server.once('listening', resolve); this.server.once('error', reject); });
    this.port = this.server.address().port;
    this.prepare();
    this.server.on('error', () => { this.error = 'Could not connect to the VATSIM companion. Restart Flight Dispatch.'; });
    this.server.on('connection', socket => {
      let authenticated = false;
      const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 5000);
      socket.on('message', raw => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
        if (!message || typeof message !== 'object') { socket.close(1008, 'Invalid message'); return; }
        if (!authenticated) {
          if (message.type !== 'hello' || !sameSecret(message.token, this.token) || message.version !== this.version) { socket.close(1008, 'Reload the companion extension from Settings'); return; }
          if (this.connected()) { socket.close(1008, 'Another browser is connected'); return; }
          authenticated = true; clearTimeout(timer); this.socket = socket;
          socket.send(JSON.stringify({ type: 'ready' }));
          return;
        }
        if (message.type === 'pong') return;
        if (message.type !== 'result' || typeof message.id !== 'string') return;
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(message.id);
        if (message.error) request.reject(new Error(String(message.error).slice(0, 400)));
        else request.resolve(message.result);
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        clearTimeout(timer);
        if (this.socket !== socket) return;
        this.socket = null;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The VATSIM browser disconnected. A filing attempt will not be repeated automatically.')); }
        this.pending.clear();
      });
    });
    this.heartbeat = setInterval(() => { if (this.connected()) this.socket.send(JSON.stringify({ type: 'ping' })); }, 20000);
    this.heartbeat.unref();
  }
  connected() { return this.socket?.readyState === WebSocket.OPEN; }
  status() { return { connected: Boolean(this.connected()), folder: this.folder, version: this.version, error: this.error }; }
  async waitForConnection({ isCancelled = () => false, onWaiting = () => {}, timeout = 30000 } = {}) {
    const started = Date.now();
    if (!this.connected()) onWaiting('Waiting for the VATSIM companion. Keep the browser with the extension open. Set it up in Settings if needed.');
    while (!this.connected()) {
      if (isCancelled()) throw new Error('Dispatch cancelled.');
      if (this.error) throw new Error(this.error);
      if (Date.now() - started >= timeout) throw new Error('VATSIM companion is not connected. In Settings, set up the companion in the browser where you sign in to VATSIM, then retry automatic filing.');
      await delay(250);
    }
  }
  request(action, args = {}, timeout = 20000) {
    if (!this.connected()) return Promise.reject(new Error('The VATSIM companion is disconnected. Keep its browser open.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The VATSIM browser did not respond. Any attempted submission will not be repeated automatically.')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ type: 'command', id, action, args, deadline: Date.now() + timeout }));
    });
  }
  async close() {
    clearInterval(this.heartbeat);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Flight Dispatch closed.')); }
    this.pending.clear();
    for (const client of this.server?.clients ?? []) client.terminate();
    this.socket = null;
    if (this.server) await new Promise(resolve => this.server.close(resolve));
  }
}
