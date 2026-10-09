// edit_document against the real executor: a missing `content` must not
// blank or cut the note, inserts land where asked, and every write goes
// through vault.process().
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

test('insert after_frontmatter goes after the closing --- line, not a --- inside a value', async () => {
  const cases = [
    ['---\ntitle: a---b\ntags: x\n---\nBody', '---\ntitle: a---b\ntags: x\n---\nNEW\nBody'],
    ['---\nnote: a\n---more\n---\nBody', '---\nnote: a\n---more\n---\nNEW\nBody'],
    ['---\n---\nBody', '---\n---\nNEW\nBody'],
    ['---\nkey: v\n---', '---\nkey: v\n---\nNEW\n'],
    // No frontmatter: a rule further down or an unclosed block doesn't count.
    ['Intro\n---\nMore', 'NEW\nIntro\n---\nMore'],
    ['----\nkey: v\n---\nBody', 'NEW\n----\nkey: v\n---\nBody'],
    ['---\nnot closed', 'NEW\n---\nnot closed'],
  ];
  for (const [before, after] of cases) {
    const { app, files } = noteVault(before);
    const result = await run(app, { operation: 'insert', position: 'after_frontmatter', content: 'NEW' });
    assert.equal(result.isError, false, before);
    assert.equal(files.get('Note.md'), after, JSON.stringify(before));
  }
  // Windows line endings: NEW right after the closing --- line.
  const { app, files } = noteVault('---\r\nkey: v\r\n---\r\nBody');
  await run(app, { operation: 'insert', position: 'after_frontmatter', content: 'NEW' });
  assert.match(files.get('Note.md'), /^---\r\nkey: v\r\n---\r?\nNEW\r?\nBody$/);
});

test('insert at the beginning and end; an unknown position is refused before the note is touched', async () => {
  const { app, files } = noteVault('---\nk: v\n---\nBody');
  await run(app, { operation: 'insert', position: 'beginning', content: 'TOP' });
  await run(app, { operation: 'insert', position: 'end', content: 'END' });
  assert.equal(files.get('Note.md'), 'TOP\n---\nk: v\n---\nBody\nEND');

  let processed = false;
  app.vault.process = async () => { processed = true; };
  const result = await run(app, { operation: 'insert', position: 'middle', content: 'X' });
  assert.equal(result.isError, true);
  assert.match(result.result, /Unknown position: middle/);
  assert.equal(processed, false);
});

test('replace_all writes through vault.process(), not vault.modify()', async () => {
  const { app, files } = noteVault('old text');
  app.vault.modify = async () => { throw new Error('vault.modify() used'); };
  const result = await run(app, { operation: 'replace_all', content: 'new text' });
  assert.equal(result.isError, false);
  assert.equal(files.get('Note.md'), 'new text');
});
