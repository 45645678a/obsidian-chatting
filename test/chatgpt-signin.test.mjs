import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, response, settings, text } from './harness.mjs';

const TOKEN_URL = 'https://auth.openai.com/oauth/token';

// A service on a fake SecretStorage, signed in with a credential that `expiresIn` ms from now expires.
function signedIn(expiresIn = -1) {
  const secrets = {};
  const app = { secretStorage: { getSecret: key => secrets[key] ?? null, setSecret: (key, value) => { secrets[key] = value; } } };
  const store = new api.ChatGPTOAuthStore(app);
  store.set({ accessToken: 'fake-access-1', refreshToken: 'fake-refresh-1', expiresAt: Date.now() + expiresIn, updatedAt: Date.now(), accountId: 'fake-account' });
  return { store, oauth: new api.ChatGPTOAuthService(store) };
}

// Token requests wait until the test answers them.
function heldTokenRequests() {
  const pending = [];
  globalThis.__providerRequest = request => {
    assert.equal(request.url, TOKEN_URL);
    return new Promise(resolve => pending.push(resolve));
  };
  return pending;
}
const until = async condition => { while (!condition()) await new Promise(resolve => setTimeout(resolve, 1)); };

test('Parallel refreshes share one token request', async () => {
  const { oauth } = signedIn();
  const pending = heldTokenRequests();
  const both = Promise.all([oauth.getUsableCredential(), oauth.getUsableCredential()]);
  await until(() => pending.length);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pending.length, 1);
  pending[0]({ status: 200, json: { access_token: 'fake-access-2', refresh_token: 'fake-refresh-2', expires_in: 3600 } });
  const [first, second] = await both;
  assert.equal(first.accessToken, 'fake-access-2');
  assert.equal(second.accessToken, 'fake-access-2');
  // The next refresh is a new request.
  const again = oauth.refreshCredential(oauth.getCredential());
  await until(() => pending.length === 2);
  pending[1]({ status: 200, json: { access_token: 'fake-access-3', refresh_token: 'fake-refresh-3' } });
  assert.equal((await again).accessToken, 'fake-access-3');
});

test('A refresh answer without a refresh token keeps the old one; without an access token it fails', async () => {
  const { oauth } = signedIn();
  globalThis.__providerRequest = async () => ({ status: 200, json: { access_token: 'fake-access-2', expires_in: 3600 } });
  const next = await oauth.getUsableCredential();
  assert.equal(next.accessToken, 'fake-access-2');
  assert.equal(next.refreshToken, 'fake-refresh-1');
  assert.deepEqual(oauth.getCredential(), next);

  const before = oauth.getCredential();
  globalThis.__providerRequest = async () => ({ status: 200, json: { refresh_token: 'fake-refresh-2' } });
  await assert.rejects(oauth.refreshCredential(before), /missing tokens/);
  assert.deepEqual(oauth.getCredential(), before);
});

test('A refresh that ends after Disconnect or another sign-in stores nothing', async () => {
  for (const [label, change] of [
    ['disconnect', (store, oauth) => oauth.clearCredential()],
    ['other sign-in', store => store.set({ ...store.get(), accessToken: 'other-access', refreshToken: 'other-refresh' })],
  ]) {
    const { store, oauth } = signedIn();
    const pending = heldTokenRequests();
    const refreshing = oauth.getUsableCredential();
    await until(() => pending.length);
    change(store, oauth);
    const expected = store.get();
    pending[0]({ status: 200, json: { access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 } });
    await assert.rejects(refreshing, /changed while the token was refreshed/, label);
    assert.deepEqual(store.get(), expected, label);
  }
});

// Signed in with a valid token; the server answers refreshes with `refresh` and Codex requests with `respond`.
function signedInRoute({ refresh, respond }) {
  const { store, oauth } = signedIn(3_600_000);
  api.setChatGPTOAuthService(oauth);
  const calls = { refresh: 0, bearers: [] };
  globalThis.__providerRequest = async request => {
    if (request.url === TOKEN_URL) { calls.refresh++; return refresh(calls.refresh); }
    calls.bearers.push(request.headers.Authorization);
    return respond(calls.bearers.length);
  };
  return { store, oauth, calls };
}
const refreshed = n => ({ status: 200, json: { access_token: `fake-access-${n + 1}`, refresh_token: `fake-refresh-${n + 1}`, expires_in: 3600 } });
const rejected = { status: 401, json: { detail: 'Unauthorized' } };
const send = () => api.sendChatGPTOAuthMessage(settings('chatgpt-oauth'), [{ role: 'user', content: 'Hi' }], [], 'System');

test('A 401 refreshes the token once and retries once with the new one', async () => {
  const { oauth, calls } = signedInRoute({ refresh: refreshed, respond: n => n === 1 ? rejected : response('chatgpt-oauth', [text('OK')]) });
  const answer = await send();
  assert.equal(answer.content[0].text, 'OK');
  assert.equal(calls.refresh, 1);
  assert.deepEqual(calls.bearers, ['Bearer fake-access-1', 'Bearer fake-access-2']);
  assert.equal(oauth.getCredential().refreshToken, 'fake-refresh-2');
});

test('A second 401 or a failed refresh keeps the reconnect error; no third request', async () => {
  let state = signedInRoute({ refresh: refreshed, respond: () => rejected });
  await assert.rejects(send(), /session rejected by the server \(HTTP 401\)\. Please reconnect/);
  assert.equal(state.calls.refresh, 1);
  assert.equal(state.calls.bearers.length, 2);
  assert.ok(state.oauth.getCredential());

  state = signedInRoute({ refresh: () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); }, respond: () => rejected });
  await assert.rejects(send(), /Please reconnect/);
  assert.equal(state.calls.bearers.length, 1);
  assert.equal(state.oauth.getCredential().accessToken, 'fake-access-1');

  // A 403 is not a token problem: no refresh.
  state = signedInRoute({ refresh: refreshed, respond: () => ({ status: 403, json: { detail: 'Forbidden' } }) });
  await assert.rejects(send(), /HTTP 403/);
  assert.equal(state.calls.refresh, 0);
});

test('Parallel 401s share one refresh, and both retry with the new token', async () => {
  const { calls } = signedInRoute({ refresh: refreshed, respond: n => n <= 2 ? rejected : response('chatgpt-oauth', [text('OK')]) });
  await Promise.all([send(), send()]);
  assert.equal(calls.refresh, 1);
  assert.deepEqual(calls.bearers.slice(2), ['Bearer fake-access-2', 'Bearer fake-access-2']);
});

test('Device-code polling survives network errors and stops when the code expires', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: fn => setTimeout(fn, 0) };
  const authorization = { deviceAuthId: 'fake-device', userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device', intervalMs: 0 };
  try {
    const { oauth } = signedIn();
    oauth.clearCredential();
    const polls = [];
    globalThis.__providerRequest = async request => {
      if (request.url === TOKEN_URL) return { status: 200, json: { access_token: 'fake-access-new', refresh_token: 'fake-refresh-new', expires_in: 3600 } };
      polls.push(request.url);
      // Like a phone that can't resolve the host for a moment, then a pending code, then the user's approval.
      if (polls.length <= 2) throw new Error('net::ERR_NAME_NOT_RESOLVED');
      if (polls.length === 3) return { status: 403, json: {} };
      return { status: 200, json: { authorization_code: 'fake-code', code_verifier: 'fake-verifier' } };
    };
    const credential = await oauth.pollDeviceAuthorization(authorization).promise;
    assert.equal(polls.length, 4);
    assert.equal(credential.accessToken, 'fake-access-new');
    assert.deepEqual(oauth.getCredential(), credential);

    // Offline until the code expires: the poll ends with an error.
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      globalThis.__providerRequest = async () => { offset += 5 * 60 * 1000; throw new Error('net::ERR_INTERNET_DISCONNECTED'); };
      await assert.rejects(oauth.pollDeviceAuthorization(authorization).promise, /code has expired/);
    } finally { Date.now = realNow; }
    // Another error status still ends the poll at once.
    globalThis.__providerRequest = async () => ({ status: 500, text: 'Server error' });
    await assert.rejects(oauth.pollDeviceAuthorization(authorization).promise, /polling failed: HTTP 500/);
  } finally { globalThis.window = previousWindow; }
});

test('The device-login dialog ignores clicks on the dimmed background; Escape still cancels the login', () => {
  // Obsidian's Modal.close() calls onClose(); the test Modal has no close().
  const ModalBase = Object.getPrototypeOf(api.ChatGPTDeviceLoginModal.prototype);
  ModalBase.close = function () { this.closed = true; this.onClose(); };
  const previousWindow = globalThis.window;
  const timers = [];
  globalThis.window = { setTimeout: fn => timers.push(fn) };
  try {
    const open = () => {
      const handle = { promise: new Promise(() => {}), cancels: 0, cancel() { handle.cancels++; } };
      const authorization = { deviceAuthId: 'fake-device', userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device', intervalMs: 5000 };
      const modal = new api.ChatGPTDeviceLoginModal({}, authorization, handle, () => {});
      const background = {};
      modal.containerEl = { querySelector: selector => selector === '.modal-bg' ? { addEventListener: (type, fn, options) => { background[type] = fn; background.capture = options?.capture; } } : null };
      modal.contentEl = { empty() {} };
      modal.ignoreBackgroundClicks();
      assert.equal(background.capture, true);
      return { modal, handle, press: () => {
        const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        background.pointerdown(event);
        assert.equal(event.prevented, true);
        assert.equal(event.stopped, true);
      } };
    };

    // A click on the background: Obsidian asks to close, the dialog stays and keeps polling.
    let { modal, handle, press } = open();
    press(); // The backdrop event never reaches Obsidian's close handler.
    assert.equal(modal.closed, undefined);
    assert.equal(handle.cancels, 0);
    // Escape or the close button: closes and cancels the poll.
    modal.close();
    assert.equal(modal.closed, true);
    assert.equal(handle.cancels, 1);

    // A press that didn't turn into a close request doesn't swallow a later Escape.
    ({ modal, handle, press } = open());
    press();
    modal.close();
    assert.equal(modal.closed, true);
    assert.equal(handle.cancels, 1);
  } finally {
    globalThis.window = previousWindow;
    delete ModalBase.close;
  }
});


test('A new sign-in refresh does not inherit the old session refresh promise', async () => {
  const { oauth, store } = signedIn();
  const pending = heldTokenRequests();
  const old = oauth.getUsableCredential();
  const oldRejected = assert.rejects(old, /changed while the token was refreshed/);
  await until(() => pending.length === 1);
  store.set({ ...store.get(), accessToken: 'new-access', refreshToken: 'new-refresh' });
  const next = oauth.getUsableCredential();
  // Allow a second token request to start without resolving the first.
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(pending.length, 2);
  pending[0]({ status: 200, json: { access_token: 'old-late', refresh_token: 'old-late-refresh' } });
  await oldRejected;
  pending[1]({ status: 200, json: { access_token: 'new-refreshed', refresh_token: 'new-refreshed-token' } });
  assert.equal((await next).accessToken, 'new-refreshed');
});

test('A 401 arriving after an account switch never sends the old conversation to the new account', async () => {
  const { oauth, store } = signedIn(3_600_000);
  api.setChatGPTOAuthService(oauth);
  let requests = 0;
  globalThis.__providerRequest = async () => {
    requests++;
    store.set({ ...store.get(), accountId: 'other-account', accessToken: 'other-access', refreshToken: 'other-refresh' });
    return rejected;
  };
  await assert.rejects(send(), /Please reconnect/);
  assert.equal(requests, 1);
});

test('Stop during 401 token refresh prevents the retry request', async () => {
  const { oauth } = signedIn(3_600_000);
  api.setChatGPTOAuthService(oauth);
  let stopped = false;
  let requests = 0;
  globalThis.__providerRequest = async request => {
    requests++;
    if (request.url === TOKEN_URL) { stopped = true; return refreshed(1); }
    return rejected;
  };
  await assert.rejects(api.sendMessage(settings('chatgpt-oauth'), [{ role: 'user', content: 'Hi' }], [], 'System', () => stopped), /cancelled/);
  assert.equal(requests, 2); // first API call and refresh only
});


for (const cancelAt of ['poll', 'exchange']) {
  test(`Cancelling during device ${cancelAt} never stores the late credential`, async () => {
    const { oauth } = signedIn();
    oauth.clearCredential();
    let release;
    globalThis.__providerRequest = async request => {
      const polling = request.url !== TOKEN_URL;
      const reply = polling ? { status: 200, json: { authorization_code: 'fake-code', code_verifier: 'fake-verifier' } }
        : refreshed(1);
      if ((cancelAt === 'poll') === polling) return new Promise(resolve => { release = () => resolve(reply); });
      return reply;
    };
    const handle = oauth.pollDeviceAuthorization({ deviceAuthId: 'fake', userCode: 'fake', intervalMs: 0 });
    await until(() => release);
    handle.cancel();
    release();
    await assert.rejects(handle.promise, /cancelled/);
    assert.equal(oauth.getCredential(), null);
  });
}
