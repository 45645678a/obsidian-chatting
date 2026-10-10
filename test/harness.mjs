// Shared test harness: bundles the real plugin modules with a fake Obsidian
// API and transport. Test files import what they need from here.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the actual production adapters/loop; only transport and the vault are fake.
export const bundled = await build({
  stdin: { contents: `
    export { ChatSettingTab } from './src/settings';
    export * from './src/api/model-catalog';
    export { sendMessage } from './src/api/client';
    export { AgentLoop } from './src/agent/loop';
    export { trimHistory } from './src/agent/history';
    export { sendAnthropicMessage } from './src/api/anthropic';
    export { sendOpenAIMessage, clearOpenAIState } from './src/api/openai';
    export { sendChatGPTOAuthMessage, setChatGPTOAuthService } from './src/api/chatgpt-oauth';
    export { buildResponsesInput, fromResponsesOutput } from './src/api/responses-format';
    export { default as ChatPlugin } from './src/main';
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'obsidian-test-transport', setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
    // The chat view's Svelte UI isn't under test; main.ts only needs it to import.
    build.onResolve({ filter: /^svelte$|\.svelte$/ }, () => ({ path: 'svelte', namespace: 'test-svelte' }));
    build.onLoad({ filter: /.*/, namespace: 'test-svelte' }, () => ({ contents: 'export const mount = () => ({}); export const unmount = () => {}; export default {};', loader: 'js' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export class App {}
      export class Plugin {}
      export class ItemView {}
      export class Menu {}
      export const MarkdownRenderer = { render: async () => {} };
      export class Modal {}
      export class PluginSettingTab {}
      export class Setting {}
      export const requireApiVersion = () => globalThis.__supportsNewObsidian === true;
      export class Notice { constructor(message) { (globalThis.__notices ??= []).push(message); } }
      export class TAbstractFile {}
      export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } }
      export const normalizePath = path => path;
      export const requestUrl = request => globalThis.__providerRequest(request);
    `, loader: 'js' }));
  } }],
});
export const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
export const settings = provider => ({ provider, model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.5', apiKey: 'fake-test-key', maxIterations: 20, enableWebSearch: true });
export const image = { id: 'image', fileName: 'test.png', mediaType: 'image/png', data: 'fake-base64', sizeBytes: 1 };
export const text = value => ({ type: 'text', text: value });
export const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
export const result = (id, content, is_error = false) => ({ type: 'tool_result', tool_use_id: id, content, is_error });
export const assistant = response => ({ role: 'assistant', content: response.content, replay: response.replay });
export const responseMessage = value => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value, annotations: [] }] });
export const nativeCall = (id, name, input) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(input) });
export function response(provider, blocks, stop = 'end_turn', index = 0) {
  if (provider === 'anthropic') return { status: 200, json: { content: blocks, stop_reason: stop } };
  const output = blocks.map(block => block.type === 'text' ? responseMessage(block.text) : block.type === 'tool_use' ? nativeCall(block.id, block.name, block.input) : block);
  const data = { id: `resp_${index}`, output, status: stop === 'max_tokens' ? 'incomplete' : 'completed' };
  if (provider === 'openai') return { status: 200, json: data };
  const events = output.map((item, output_index) => ({ type: 'response.output_item.done', item, output_index }));
  events.push({ type: stop === 'max_tokens' ? 'response.incomplete' : 'response.completed', response: { ...data, output: [] } });
  return sse(events);
}
export function sse(events) {
  const body = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return { status: 200, text: body, get json() { throw new SyntaxError('iOS lazy JSON getter'); } };
}
export function transport(handler) {
  const requests = [];
  globalThis.__providerRequest = async request => {
    const body = JSON.parse(request.body);
    requests.push(body);
    return handler(body, requests.length - 1, request);
  };
  return requests;
}
export function vaultApp() {
  const files = new Map([['Cases/Case Template.md', '# Template\n日本語本文'], ['Untitled.md', 'Original']]);
  const app = {
    workspace: { getActiveFile: () => ({ path: 'Untitled.md' }) },
    vault: {
      configDir: '.obsidian', adapter: { append: async () => {} },
      getName: () => 'Test vault',
      getMarkdownFiles: () => [...files.keys()].map(path => ({ path })),
      getFileByPath: path => files.has(path) ? { path } : null,
      getFolderByPath: () => ({}),
      cachedRead: async file => files.get(file.path),
      create: async (path, content) => { assert.ok(!files.has(path)); files.set(path, content); return { path }; },
      process: async (file, fn) => { files.set(file.path, fn(files.get(file.path))); },
      modify: async (file, content) => { files.set(file.path, content); },
    },
  };
  return { app, files };
}
export function callbacks(extra = {}) {
  const errors = [], texts = [], executed = [];
  return { errors, texts, executed, onThinking() {}, onToolCall(name) { executed.push(name); }, onToolResult() {}, onResponse(value) { texts.push(value); }, onAskUser: async () => 'yes', onError(error) { errors.push(error); }, ...extra };
}
