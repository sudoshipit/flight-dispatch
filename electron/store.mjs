import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateSettings } from '../shared/domain.mjs';

export class Store {
  constructor(directory, secure) {
    this.directory = directory;
    this.secure = secure;
    fs.mkdirSync(directory, { recursive: true });
  }
  read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.directory, name + '.json'), 'utf8').replace(/^\uFEFF/, '')); }
    catch { return structuredClone(fallback); }
  }
  write(name, value) {
    const target = path.join(this.directory, name + '.json');
    fs.writeFileSync(target + '.tmp', JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(target + '.tmp', target);
  }
  settings() {
    try { return validateSettings(this.read('settings', DEFAULT_SETTINGS)); }
    catch { return structuredClone(DEFAULT_SETTINGS); }
  }
  publicSettings() {
    const keys = this.read('secrets', {});
    return { ...this.settings(), hasAviationstackKey: Boolean(keys.aviationstack), hasFlightawareKey: Boolean(keys.flightaware) };
  }
  saveSettings(value) {
    const settings = validateSettings(value);
    const secrets = this.read('secrets', {});
    for (const name of ['aviationstack', 'flightaware']) {
      const key = value[name + 'Key'];
      if (key !== undefined && typeof key !== 'string') throw new Error('Invalid API key.');
      if (typeof key === 'string') {
        if (key.length > 500) throw new Error('API key is too long.');
        if (key.trim()) {
          if (!this.secure?.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. The key has not been saved.');
          secrets[name] = this.secure.encryptString(key.trim()).toString('base64');
        } else if (value['remove' + name + 'Key']) delete secrets[name];
      }
    }
    this.write('secrets', secrets);
    this.write('settings', settings);
    return this.publicSettings();
  }
  secret(name) {
    const encoded = this.read('secrets', {})[name];
    if (!encoded) return '';
    try { return this.secure.decryptString(Buffer.from(encoded, 'base64')); }
    catch { throw new Error('This API key could not be decrypted. Re-enter it in Settings.'); }
  }
  savePlan(plan, { updateLanding = false } = {}) {
    const previous = this.read('history', []);
    // Filing/import operations may have started before a touchdown was recorded.
    const landing = previous.find(p => p.id === plan.id)?.landing;
    if (!updateLanding && landing) plan = { ...plan, landing };
    const history = previous.filter(p => p.id !== plan.id);
    this.write('history', [plan, ...history].slice(0, 30));
    return plan;
  }
  getPlan(id) {
    const plan = this.read('history', []).find(p => p.id === id);
    if (!plan) throw new Error('This briefing is no longer in your history. Import it again.');
    return plan;
  }
}
