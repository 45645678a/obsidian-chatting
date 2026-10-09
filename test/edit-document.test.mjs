// edit_document against the real executor: a missing `content` must not
// blank or cut the note.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

function noteVault(text) {
  const files = new Map([['Note.md', text]]);
  const app = {
    workspace: { getActiveFile: () => null },
    vault: {
      getFileByPath: path => files.has(path) ? { path } : null,
      cachedRead: async file => files.get(file.path),
      process: async (file, fn) => { files.set(file.path, fn(files.get(file.path))); },
      modify: async (file, content) => { files.set(file.path, content); },
    },
  };
  return { app, files };
}

const run = (app, input) => api.executeTool(app, 'edit_document', { path: 'Note.md', ...input }, async () => 'yes');

test('edit_document without content is an error and leaves the note alone', async () => {
  for (const input of [
    { operation: 'replace_all' },
    { operation: 'find_replace', find: 'keep' },
    { operation: 'insert', position: 'end' },
  ]) {
    const { app, files } = noteVault('keep this text');
    const result = await run(app, input);
    assert.equal(result.isError, true, input.operation);
    assert.match(result.result, /'content' is required/);
    assert.equal(files.get('Note.md'), 'keep this text', input.operation);
  }
});

test('edit_document with an explicit empty content deletes on purpose', async () => {
  const { app, files } = noteVault('keep this text');
  const result = await run(app, { operation: 'find_replace', find: ' this', content: '' });
  assert.equal(result.isError, false);
  assert.equal(files.get('Note.md'), 'keep text');
});
