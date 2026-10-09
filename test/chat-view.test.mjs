// The chat view and the plugin's chat commands with a fake Svelte component:
// the API history cap, what the chat history saves, Copy transcript, and
// commands waiting for the view.
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { api, settings, text, image, response, transport, vaultApp, callbacks } from './harness.mjs';

beforeEach(() => {
  api.clearOpenAIState();
  globalThis.__notices = [];
});

// Records what the view shows, in place of ChatContainer.svelte.
function fakeChat() {
  let nextId = 0;
  const chat = {
    shown: [],
    askUser: null,
    addUserMessage(value, images = []) { chat.shown.push({ id: nextId++, type: 'user', text: value, images }); },
    addAssistantMessage(value) { chat.shown.push({ id: nextId++, type: 'assistant', text: value }); },
    addToolCall(name, input) { chat.shown.push({ id: nextId, type: 'tool-call', toolName: name, toolInput: input }); return nextId++; },
    updateToolResult(id) { const msg = chat.shown.find(m => m.id === id); if (msg) msg.type = 'tool-result'; },
    addError(value) { chat.shown.push({ id: nextId++, type: 'error', text: value }); },
    showThinking() {}, hideThinking() {},
    showAskUser(question) { chat.addAssistantMessage(question); return new Promise(resolve => { chat.askUser = resolve; }); },
    setInputEnabled() {}, clearMessages() { chat.shown = []; }, focus() {}, setModel() {},
    setSelection() {}, getSelection: () => null,
  };
  return chat;
}

// A plugin that loads `saved` as its chat-state.json (none when undefined),
// records its writes, and has a chat view with a fake component.
async function chatSetup(provider, saved) {
  const { app } = vaultApp();
  const writes = [];
  app.vault.adapter = {
    append: async () => {},
    read: async () => { if (!saved) throw new Error('ENOENT'); return JSON.stringify(saved); },
    // exists() and the path check are for the chat saving fix (PR #10),
    // which checks for the file before reading and writes a copy next to it.
    exists: async () => !!saved,
    write: async (path, data) => { if (path.endsWith('/chat-state.json')) writes.push(JSON.parse(data)); },
  };
  const plugin = new api.ChatPlugin();
  plugin.app = app;
  plugin.agent = new api.AgentLoop(app, settings(provider));
  await plugin.loadChatHistory();
  const view = new api.ObsidianChatView({}, plugin);
  const chat = fakeChat();
  view.chatContainer = chat;
  return { app, plugin, view, chat, writes };
}

// Waits until `condition()` holds (the view sends and saves without
// awaiting); fails after about a second.
async function until(condition) {
  for (let i = 0; i < 1000 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(condition(), 'timed out');
}

const answering = provider => transport((body, index) => response(provider, [text(`A${index + 1}`)]));

test('The API history keeps up to 80 messages when saved and loaded, with its images; past 80 a turn cuts it to 60', async () => {
  const { plugin, view, writes } = await chatSetup('anthropic');
  const requests = answering('anthropic');
  const messages = [];
  for (let i = 0; i < 35; i++) {
    const content = i === 0 ? [{ type: 'image', image: { ...image, id: 'old-image' } }, text(`Q${i}`)] : `Q${i}`;
    messages.push({ role: 'user', content }, { role: 'assistant', content: [text(`A${i}`)] });
  }
  plugin.agent.importMessages(messages);
  assert.equal(plugin.agent.exportMessages().length, 70);

  await view.handleUserMessage('Next', null);
  assert.equal(requests[0].messages.length, 71);

  // Saved and loaded again: the oldest turn and its image are still there.
  await until(() => writes.length === 1);
  const restored = await chatSetup('anthropic', JSON.parse(JSON.stringify(writes[0])));
  const history = restored.plugin.agent.exportMessages();
  assert.equal(history.length, 72);
  assert.equal(history[0].content[0].image.data, image.data);

  // Up to 80 messages, nothing is cut.
  for (let i = 0; i < 4; i++) await restored.view.handleUserMessage(`More ${i}`, null);
  assert.equal(requests.at(-1).messages.length, 79);
  assert.equal(restored.plugin.agent.exportMessages().length, 80);
  // Past 80, whole turns are cut from the start, down to 60 messages.
  await restored.view.handleUserMessage('More 4', null);
  assert.equal(requests.at(-1).messages.length, 61);
  const cut = restored.plugin.agent.exportMessages();
  assert.equal(cut.length, 62);
  assert.equal(cut[0].content, 'Q10');
});

test('OpenAI keeps chaining once the history is past 80 messages: it is cut every few turns, not on each', async () => {
  const agent = new api.AgentLoop(vaultApp().app, settings('openai'));
  const messages = [];
  for (let i = 0; i < 40; i++) messages.push({ role: 'user', content: `Q${i}` }, { role: 'assistant', content: [text(`A${i}`)] });
  agent.importMessages(messages);
  const requests = transport((body, index) => response('openai', [text(`A${index}`)], 'end_turn', index));
  for (let i = 0; i < 3; i++) await agent.run(`More ${i}`, callbacks());
  // The first turn cuts the history to 60 (a new array: sent in full); the
  // next turns add to the same array and chain to the previous response.
  assert.equal(requests[0].previous_response_id, undefined);
  assert.equal(requests[1].previous_response_id, 'resp_0');
  assert.equal(requests[2].previous_response_id, 'resp_1');
  assert.equal(requests[2].input.length, 1);
});
