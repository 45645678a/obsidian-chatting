import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

test('OpenAI model list (API key): chat models only, newest first, dated snapshots folded into their model', async () => {
  const data = [
    ['gpt-4o', 1715], ['gpt-4o-2024-08-06', 1722], ['gpt-4-0613', 1686], ['gpt-6-sol', 1790], ['gpt-5.4', 1772],
    ['gpt-5.4-2026-03-05', 1772], ['o3-pro-2025-06-10', 1749], ['gpt-4o-mini-tts', 1742], ['gpt-3.5-turbo-instruct', 1692],
    ['gpt-live-1', 1789], ['text-embedding-3-large', 1705], ['gpt-realtime', 1756], ['dall-e-3', 1698],
  ].map(([id, created]) => ({ id, created, object: 'model', owned_by: 'openai' }));
  globalThis.__providerRequest = async () => ({ status: 200, json: { object: 'list', data } });
  const identity = await api.catalogIdentity('openai', 'fake-test-key');
  const models = await api.refreshCatalog({ entries: [] }, 'openai', identity, 'fake-test-key', {}, true);
  // A snapshot without its plain model stays (o3-pro-2025-06-10).
  assert.deepEqual(models.map(m => m.value), ['gpt-6-sol', 'gpt-5.4', 'o3-pro-2025-06-10', 'gpt-4o', 'gpt-4-0613']);
  assert.deepEqual(models[0], { value: 'gpt-6-sol', label: 'gpt-6-sol' });
});
