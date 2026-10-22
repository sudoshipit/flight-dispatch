const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('dispatch', {
  bootstrap: invoke('dispatch:bootstrap'), catalog: invoke('dispatch:catalog'), syncAirframes: invoke('dispatch:sync-airframes'), airportPositions: invoke('dispatch:airport-positions'),
  saveSettings: invoke('dispatch:settings'), importLatest: invoke('dispatch:import'),
  simbriefFlights: invoke('dispatch:simbrief-flights'), importSelected: invoke('dispatch:import-selected'),
  generate: invoke('dispatch:generate'), cancel: invoke('dispatch:cancel'),
  refresh: invoke('dispatch:refresh'), file: invoke('dispatch:file'),
  open: invoke('dispatch:open'), login: invoke('dispatch:login'),
  companionStatus: invoke('dispatch:companion-status'), companionSetup: invoke('dispatch:companion-setup'),
  startTracking: invoke('dispatch:telemetry-start'), followFlight: invoke('dispatch:telemetry-follow'), stopTracking: invoke('dispatch:telemetry-stop'),
  switchTracking: invoke('dispatch:telemetry-switch'),
  onTelemetry: (callback) => { const handler = (_event, value) => callback(value); ipcRenderer.on('dispatch:telemetry', handler); return () => ipcRenderer.removeListener('dispatch:telemetry', handler); },
  onProgress: (callback) => { const handler = (_event, value) => callback(value); ipcRenderer.on('dispatch:progress', handler); return () => ipcRenderer.removeListener('dispatch:progress', handler); },
});
