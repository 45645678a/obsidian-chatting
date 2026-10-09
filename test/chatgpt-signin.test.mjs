import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

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
