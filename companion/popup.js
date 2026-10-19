async function refresh() {
  const { message } = await chrome.storage.local.get('message');
  document.querySelector('#status').textContent = message || 'Open Flight Dispatch to connect.';
}
document.querySelector('#connect').addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'reconnect' }); });
chrome.storage.onChanged.addListener(refresh);
void refresh();
