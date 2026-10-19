import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { vatsimPageState } from '../companion/page-state.mjs';
function state(html, url = 'https://my.vatsim.net/pilots/flightplan') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getClientRects = function() { return this.style.display === 'none' ? [] : [{width:100,height:30}]; };
  return dom.window.eval(`(${vatsimPageState.toString()})()`);
}
test('an authenticated filing form is not mistaken for a login because of unrelated links or widgets', () => {
  assert.equal(state('<button>File Plan (FPL)</button><footer><a>Sign In</a></footer><iframe src="https://challenges.cloudflare.com/widget"></iframe>').state, 'ready');
});
test('security verification and an actual login form are distinct states', () => {
  assert.equal(state('<title>Just a moment...</title>').state, 'verification');
  assert.equal(state('<input type="password"><button>Sign In</button>').state, 'authentication');
  assert.equal(state('<button style="display:none">Sign In</button>').state, 'loading');
  assert.equal(state('<title>Just a moment...</title>', 'https://auth.vatsim.net/login').state, 'verification');
  assert.equal(state('<input type="password">', 'https://auth.vatsim.net/login').state, 'authentication');
});
