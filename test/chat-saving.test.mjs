// Saving the chat (chat-state.json): nothing is saved before the saved chat
// was read, every save writes two copies and loading takes the newer whole
// one, an unreadable file is kept aside instead of overwritten, and saves
// never overlap.
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { api, settings, vaultApp } from './harness.mjs';

beforeEach(() => {
  globalThis.__notices = [];
});

const DIR = '.obsidian/plugins/chatting-with-ai';
const STATE = `${DIR}/chat-state.json`;
const NEXT = `${DIR}/chat-state.next.json`;
const LEGACY = '.obsidian/plugins/obsidian-chatting/chat-state.json';
const tick = () => new Promise(resolve => setTimeout(resolve, 2));

// A saved chat with one user message `text`.
const savedState = (text, savedAt) => JSON.stringify({
  ...(savedAt === undefined ? {} : { savedAt }),
  chatHistory: [{ type: 'user', text }],
  agentMessages: [{ role: 'user', content: text }],
});

function pluginOn(adapter) {
  const { app } = vaultApp();
  app.vault.adapter = adapter;
  const plugin = new api.ChatPlugin();
  plugin.app = app;
  plugin.agent = new api.AgentLoop(app, settings('anthropic'));
  return plugin;
}

// A plugin that loaded from chat-state.json holding `content` (undefined: no
// file), on an in-memory adapter like Obsidian's: write replaces a file's
// content, rename refuses an existing destination. Records writes and renames.
async function loadFrom(content, { renameFails = false, next, legacy } = {}) {
  const files = new Map();
  if (content !== undefined) files.set(STATE, content);
  if (next !== undefined) files.set(NEXT, next);
  if (legacy !== undefined) files.set(LEGACY, legacy);
  const writes = [], renames = [];
  const plugin = pluginOn({
    read: async (path) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path); },
    exists: async (path) => files.has(path),
    write: async (path, data) => { if (path === STATE) writes.push(JSON.parse(data)); files.set(path, data); },
    rename: async (from, to) => {
      if (renameFails) throw new Error('EBUSY');
      if (files.has(to)) throw new Error('Destination file already exists!');
      renames.push([from, to]);
      files.set(to, files.get(from));
      files.delete(from);
    },
  });
  await plugin.loadChatHistory();
  return { plugin, files, writes, renames };
}

const texts = plugin => plugin.chatHistory.map(entry => entry.text);

test('Nothing is saved before the saved chat has been read', async () => {
  const writes = [];
  let finishRead;
  const plugin = pluginOn({
    read: path => path === STATE ? new Promise(resolve => { finishRead = resolve; }) : Promise.reject(new Error('ENOENT')),
    exists: async () => true,
    write: async (path, data) => { if (path === STATE) writes.push(JSON.parse(data)); },
  });
  const loading = plugin.loadChatHistory();
  // Obsidian unloads the plugin while it is still starting.
  plugin.onunload();
  await plugin.saveChatHistory();
  assert.deepEqual(writes, []);

  finishRead(savedState('Saved before'));
  await loading;
  assert.deepEqual(texts(plugin), ['Saved before']);
  await plugin.saveChatHistory();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].chatHistory.map(e => e.text), ['Saved before']);
});

test('A save writes the state twice: chat-state.next.json, then chat-state.json; nothing is deleted or renamed', async () => {
  const { plugin, files, renames } = await loadFrom(savedState('Old'));
  const order = [];
  const write = plugin.app.vault.adapter.write;
  plugin.app.vault.adapter.write = async (path, data) => { order.push(path); await write(path, data); };
  plugin.chatHistory.push({ type: 'user', text: 'New' });
  await plugin.saveChatHistory();
  assert.deepEqual(order, [NEXT, STATE]);
  assert.equal(files.get(NEXT), files.get(STATE));
  assert.deepEqual(JSON.parse(files.get(STATE)).chatHistory.map(e => e.text), ['Old', 'New']);
  assert.deepEqual(renames, []);
});

test('Both copies whole: the newer one loads (ended between the two writes, or chat-state.json could not be written)', async () => {
  const newerCopy = await loadFrom(savedState('Old', 1000), { next: savedState('New', 2000) });
  assert.deepEqual(texts(newerCopy.plugin), ['New']);
  const newerMain = await loadFrom(savedState('Main', 3000), { next: savedState('Copy', 2000) });
  assert.deepEqual(texts(newerMain.plugin), ['Main']);
  // Saved before savedAt existed: chat-state.json wins.
  const older = await loadFrom(savedState('Main'), { next: savedState('Copy') });
  assert.deepEqual(texts(older.plugin), ['Main']);
  // A save records when it was written.
  await newerCopy.plugin.saveChatHistory();
  assert.ok(JSON.parse(newerCopy.files.get(STATE)).savedAt > 2000);
});

test('Obsidian ended in the middle of a save (reload, quit): the chat loads from the whole copy', async () => {
  // Cut off while chat-state.json was written (emptied, or never there).
  for (const content of [undefined, '', '{"chatHistory": [{"ty']) {
    const { plugin, renames } = await loadFrom(content, { next: savedState('Kept') });
    assert.deepEqual(texts(plugin), ['Kept']);
    assert.deepEqual(renames, []);
  }
  // Cut off while the copy was written: chat-state.json is still whole.
  const { plugin } = await loadFrom(savedState('Old'), { next: '' });
  assert.deepEqual(texts(plugin), ['Old']);
  assert.deepEqual(globalThis.__notices, []);
});

test('An unreadable chat-state.json is kept aside before starting fresh, with one notice', async () => {
  for (const content of ['{"chatHistory": [', '[]', 'null']) {
    globalThis.__notices = [];
    const { plugin, writes, renames } = await loadFrom(content);
    assert.equal(renames.length, 1);
    assert.equal(renames[0][0], STATE);
    assert.match(renames[0][1], /^\.obsidian\/plugins\/chatting-with-ai\/chat-state\.corrupt-\d+\.json$/);
    assert.equal(globalThis.__notices.length, 1);
    assert.match(globalThis.__notices[0], /couldn't be read.*chat-state\.corrupt-\d+\.json/);
    // The fresh chat is saved to a new file; the old one is safe.
    await plugin.saveChatHistory();
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].chatHistory, []);
  }
});

test('An unreadable chat-state.json that cannot be moved aside is never overwritten', async () => {
  const { plugin, writes } = await loadFrom('not json', { renameFails: true });
  assert.equal(globalThis.__notices.length, 1);
  assert.match(globalThis.__notices[0], /isn't saved until Obsidian restarts/);
  plugin.chatHistory.push({ type: 'user', text: 'New' });
  await plugin.saveChatHistory();
  assert.deepEqual(writes, []);
});

test('No chat-state.json yet: the legacy file loads; else a first run starts silently and saves', async () => {
  const legacy = await loadFrom(undefined, { legacy: savedState('From the old plugin folder') });
  assert.deepEqual(texts(legacy.plugin), ['From the old plugin folder']);

  const { plugin, writes, renames } = await loadFrom(undefined);
  assert.deepEqual(texts(plugin), []);
  assert.deepEqual(renames, []);
  assert.deepEqual(globalThis.__notices, []);
  await plugin.saveChatHistory();
  assert.equal(writes.length, 1);
});

test('Saves never overlap: calls during a write share one next write with the latest state', async () => {
  const writes = [], pending = [];
  let active = 0, maxActive = 0;
  const plugin = pluginOn({
    read: async () => { throw new Error('ENOENT'); },
    exists: async () => false,
    write: (path, data) => {
      // The copy written first goes through at once; chat-state.json waits.
      if (path !== STATE) return Promise.resolve();
      active++;
      maxActive = Math.max(maxActive, active);
      writes.push(JSON.parse(data));
      return new Promise(resolve => pending.push(() => { active--; resolve(); }));
    },
  });
  await plugin.loadChatHistory();

  const first = plugin.saveChatHistory();
  while (writes.length < 1) await tick();
  plugin.chatHistory.push({ type: 'user', text: 'One' });
  const second = plugin.saveChatHistory();
  plugin.chatHistory.push({ type: 'user', text: 'Two' });
  const third = plugin.saveChatHistory();
  assert.equal(second, third);
  assert.equal(writes.length, 1);

  pending.shift()();
  await first;
  while (writes.length < 2) await tick();
  assert.deepEqual(writes[1].chatHistory.map(e => e.text), ['One', 'Two']);
  pending.shift()();
  await third;
  assert.equal(writes.length, 2);
  assert.equal(maxActive, 1);
});
