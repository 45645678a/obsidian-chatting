// A turn sent with a selection may change only the selected text of that
// note: the tools enforce it, the instruction in the message isn't enough.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, call, callbacks, response, settings, text, transport, vaultApp } from './harness.mjs';

const NOTE = '## Feedback\n- crowded plan\n- low contrast\n\n## Decisions\n- crowded plan stays grouped\n';
const SELECTED = '- crowded plan\n- low contrast';

function vault(notes) {
  const files = new Map(Object.entries(notes));
  const app = {
    workspace: { getActiveFile: () => ({ path: 'Review.md' }) },
    vault: {
      getFileByPath: path => files.has(path) ? { path } : null,
      getAbstractFileByPath: path => files.has(path) ? { path } : null,
      getFolderByPath: () => ({}),
      cachedRead: async file => files.get(file.path),
      process: async (file, fn) => { files.set(file.path, fn(files.get(file.path))); },
      modify: async (file, content) => { files.set(file.path, content); },
    },
    fileManager: {
      processFrontMatter: async () => { files.set('touched', 'yes'); },
      renameFile: async () => { files.set('touched', 'yes'); },
      trashFile: async () => { files.set('touched', 'yes'); },
    },
  };
  return { app, files };
}

const run = (app, name, input, scope) => api.executeTool(app, name, input, async () => 'yes', scope);

test('find_replace changes the text inside the selection, not an earlier match elsewhere', async () => {
  const { app, files } = vault({ 'Review.md': `Intro: - crowded plan\n\n${NOTE}` });
  const scope = { filePath: 'Review.md', text: SELECTED };
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- crowded plan', content: '- [ ] Group the plan by bed' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), 'Intro: - crowded plan\n\n## Feedback\n- [ ] Group the plan by bed\n- low contrast\n\n## Decisions\n- crowded plan stays grouped\n');
  // The scope follows the edit: the next edit in the turn finds the new text.
  assert.equal(scope.text, '- [ ] Group the plan by bed\n- low contrast');
  const second = await run(app, 'edit_document', { operation: 'find_replace', find: '- [ ] Group the plan by bed', content: '- [ ] Group by bed' }, scope);
  assert.equal(second.isError, false);
  assert.match(files.get('Review.md'), /## Feedback\n- \[ \] Group by bed\n- low contrast/);
});

test('Text outside the selection, a whole-note replace or an insert is refused; the note stays as it was', async () => {
  for (const input of [
    { operation: 'find_replace', find: '- crowded plan stays grouped', content: 'gone' },
    { operation: 'find_replace', find: '## Decisions', content: '## Done' },
    { operation: 'replace_all', content: 'everything new' },
    { operation: 'insert', position: 'end', content: 'more' },
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE });
    const result = await run(app, 'edit_document', { path: 'Review.md', ...input }, { filePath: 'Review.md', text: SELECTED });
    assert.equal(result.isError, true, input.operation);
    assert.match(result.result, /^Not changed:/);
    assert.equal(files.get('Review.md'), NOTE, input.operation);
  }
});

test('The selected note can\'t be renamed, deleted or get new properties; other notes stay editable', async () => {
  const scope = { filePath: 'Review.md', text: SELECTED };
  for (const [name, input] of [
    ['rename_file', { path: 'Review.md', new_path: 'Old.md' }],
    ['delete_file', { path: 'Review.md' }],
    ['set_properties', { path: 'Review.md', properties: { status: 'done' } }],
    ['set_properties', { properties: { status: 'done' } }],
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE });
    const result = await run(app, name, input, scope);
    assert.equal(result.isError, true, name);
    assert.match(result.result, /only that selection may change/);
    assert.equal(files.has('touched'), false, name);
  }
  const { app, files } = vault({ 'Review.md': NOTE, 'Tasks.md': 'Old' });
  const other = await run(app, 'edit_document', { path: 'Tasks.md', operation: 'replace_all', content: 'New' }, scope);
  assert.equal(other.isError, false);
  assert.equal(files.get('Tasks.md'), 'New');
});

test('A selected text that also appears earlier: the selected copy changes (by its offset), the earlier stays', async () => {
  const note = '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob\n';
  const from = note.lastIndexOf('- [ ] call Bob');
  const { app, files } = vault({ 'Review.md': note });
  const scope = { filePath: 'Review.md', text: '- [ ] call Bob', from };
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob about the quote' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob about the quote\n');
  // A second edit stays on the same copy.
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- [ ]', content: '- [x]' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [x] call Bob about the quote\n');
});

test('A folder the selected note is in can\'t be renamed or deleted', async () => {
  // The harness's normalizePath returns the path as given, so the trailing
  // slash and the root '/' below reach the guard unchanged.
  const scope = { filePath: 'Projects/Plan.md', text: 'x' };
  for (const [name, input] of [
    ['delete_file', { path: 'Projects' }],
    ['rename_file', { path: 'Projects/', new_path: 'Archive' }],
    ['delete_file', { path: '/' }],
  ]) {
    const { app, files } = vault({ 'Projects/Plan.md': 'x', 'Projects': '' });
    const result = await run(app, name, input, scope);
    assert.match(result.result, /only that selection may change/, `${name} ${input.path}`);
    assert.equal(files.has('touched'), false);
  }
  // A folder with a similar name is not the note's folder.
  const { app } = vault({ 'Projects/Plan.md': 'x', 'Projects-old': '' });
  const result = await run(app, 'delete_file', { path: 'Projects-old' }, scope);
  assert.equal(result.isError, false);
});

test('Text typed before the selection moves it: the snapshot keeps the original copy', async () => {
  const note = '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] call Bob\n';
  const scope = { filePath: 'Review.md', text: '- [ ] call Bob', from: note.lastIndexOf('- [ ] call Bob'), sourceText: note };
  // After selecting, the user adds a line just above the selected copy.
  const { app, files } = vault({ 'Review.md': note.replace('## Friday\n', '## Friday\n- [ ] buy milk\n') });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob about the quote' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), '## Monday\n- [ ] call Bob\n\n## Friday\n- [ ] buy milk\n- [ ] call Bob about the quote\n');
  assert.equal(scope.from, files.get('Review.md').lastIndexOf('- [ ] call Bob'));
});

test('A line typed above both copies (more than the gap between them): the selected copy, counted from the top, changes', async () => {
  const note = '# List\n\n- [ ] Buy milk\n- [ ] Call Ana\n- [ ] Buy milk\n';
  const scope = { filePath: 'Review.md', text: 'Buy milk', from: note.lastIndexOf('Buy milk'), occurrence: 1, sourceText: note };
  // After selecting the second copy, the user types a line under the heading.
  const typed = note.replace('# List\n', '# List\nTyped above the list after selecting.\n');
  const { app, files } = vault({ 'Review.md': typed });
  const first = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'Buy milk', content: 'Buy oat milk' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), typed.replace(/Buy milk\n$/, 'Buy oat milk\n'));
  // The scope follows the edit: a second edit lands on the same copy.
  const second = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'oat milk', content: 'oat milk (2 l)' }, scope);
  assert.equal(second.isError, false);
  assert.match(files.get('Review.md'), /- \[ \] Buy milk\n- \[ \] Call Ana\n- \[ \] Buy oat milk \(2 l\)\n$/);
});

test('A note saved with CRLF line breaks: the selection (with LF, as the editor gives it) is found, the rest stays as it was', async () => {
  const note = '## Monday\n- [ ] call Bob\n- [ ] pay rent\n\n## Friday\n- [ ] call Bob\n- [ ] pay rent\n';
  const selected = '- [ ] call Bob\n- [ ] pay rent';
  const scope = { filePath: 'Review.md', text: selected, from: note.lastIndexOf(selected) };
  const { app, files } = vault({ 'Review.md': note.replace(/\n/g, '\r\n') });
  const first = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'call Bob', content: 'call Bob\n- [ ] call Ann' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), '## Monday\r\n- [ ] call Bob\r\n- [ ] pay rent\r\n\r\n## Friday\r\n- [ ] call Bob\r\n- [ ] call Ann\r\n- [ ] pay rent\r\n');
  // The scope stays in the editor's terms, so the next edit lands on the same copy.
  assert.equal(scope.text, '- [ ] call Bob\n- [ ] call Ann\n- [ ] pay rent');
  assert.equal(scope.from, note.lastIndexOf(selected));
  await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'pay rent', content: 'pay rent today' }, scope);
  assert.equal(files.get('Review.md'), '## Monday\r\n- [ ] call Bob\r\n- [ ] pay rent\r\n\r\n## Friday\r\n- [ ] call Bob\r\n- [ ] call Ann\r\n- [ ] pay rent today\r\n');
});

test('find matching more than once inside the selection changes the first and says so', async () => {
  const { app, files } = vault({ 'Review.md': NOTE });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- ', content: '* ' }, { filePath: 'Review.md', text: SELECTED });
  assert.match(result.result, /^\[Note: Multiple matches found in the selection, replacing first occurrence\.\]\nSuccessfully/);
  assert.equal(files.get('Review.md'), NOTE.replace('- crowded plan\n', '* crowded plan\n'));
});

test('Another note can be renamed or get properties during a selection turn', async () => {
  const scope = { filePath: 'Review.md', text: SELECTED };
  for (const [name, input] of [
    ['rename_file', { path: 'Tasks.md', new_path: 'Done/Tasks.md' }],
    ['set_properties', { path: 'Tasks.md', properties: { status: 'done' } }],
  ]) {
    const { app, files } = vault({ 'Review.md': NOTE, 'Tasks.md': 'Old' });
    const result = await run(app, name, input, scope);
    assert.equal(result.isError, false, name);
    assert.equal(files.get('touched'), 'yes', name);
  }
});

test('selectionScope records where the selection starts, also when it was made backwards', () => {
  const lines = NOTE.split('\n');
  const editor = {
    getValue: () => NOTE,
    // Selected from the end of line 3 back to the start of line 2: the cursor is before the anchor.
    getCursor: which => which === 'from' ? { line: 1, ch: 0 } : { line: 2, ch: 14 },
    posToOffset: pos => lines.slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch,
  };
  const scope = api.selectionScope(editor, SELECTED, 'Review.md');
  assert.deepEqual(scope, { text: SELECTED, filePath: 'Review.md', from: NOTE.indexOf(SELECTED), occurrence: 0, sourceText: NOTE });
  // A repeated text: the copies before the selected one are counted.
  const repeated = '- a\n- b\n- a\n';
  const second = { getValue: () => repeated, getCursor: () => ({ line: 2, ch: 0 }), posToOffset: pos => pos.line * 4 + pos.ch };
  assert.equal(api.selectionScope(second, '- a', 'Review.md').occurrence, 1);
});

test('A selection no longer in the note as selected (changed meanwhile) can\'t be edited', async () => {
  const { app, files } = vault({ 'Review.md': NOTE.replace('low contrast', 'contrast fixed') });
  const before = files.get('Review.md');
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: '- crowded plan', content: 'x' }, { filePath: 'Review.md', text: SELECTED });
  assert.match(result.result, /no longer in Review\.md as it was selected/);
  assert.equal(files.get('Review.md'), before);
});

test('In a chat turn with a selection the model can\'t change the rest of the note; without one it can', async () => {
  const { app, files } = vaultApp();
  files.set('Review.md', NOTE);
  const agent = new api.AgentLoop(app, settings('anthropic'));
  const requests = transport((body, index) => index === 0
    ? response('anthropic', [call('e1', 'edit_document', { path: 'Review.md', operation: 'replace_all', content: 'all new' })], 'tool_use')
    : response('anthropic', [text('Done.')]));
  const selection = { filePath: 'Review.md', text: SELECTED };
  await agent.run('Rewrite this as tasks', callbacks(), selection);
  assert.equal(files.get('Review.md'), NOTE);
  assert.match(JSON.stringify(requests[1]), /Not changed: the user selected text in Review\.md/);

  // The next turn has no selection: nothing is held back.
  transport((body, index) => index === 0
    ? response('anthropic', [call('e2', 'edit_document', { path: 'Review.md', operation: 'replace_all', content: 'all new' })], 'tool_use')
    : response('anthropic', [text('Done.')]));
  await agent.run('Now rewrite the whole note', callbacks(), null);
  assert.equal(files.get('Review.md'), 'all new');
});


test('A removed selected copy never redirects an edit to another identical copy', async () => {
  const original = 'first: task\nsecond: task\n';
  const scope = { filePath: 'Review.md', text: 'task', from: original.lastIndexOf('task'), occurrence: 1, sourceText: original };
  const changed = 'first: task\nsecond: gone\n';
  const { app, files } = vault({ 'Review.md': changed });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'task', content: 'DONE' }, scope);
  assert.equal(result.isError, true);
  assert.equal(files.get('Review.md'), changed);
});

test('Inserting a duplicate above the selection preserves the original selected copy', async () => {
  const original = 'heading\nselected: task\n';
  const scope = { filePath: 'Review.md', text: 'task', from: original.indexOf('task'), occurrence: 0, sourceText: original };
  const changed = 'task\n' + original;
  const { app, files } = vault({ 'Review.md': changed });
  const result = await run(app, 'edit_document', { path: 'Review.md', operation: 'find_replace', find: 'task', content: 'DONE' }, scope);
  assert.equal(result.isError, false);
  assert.equal(files.get('Review.md'), 'task\nheading\nselected: DONE\n');
});


test('Deleting the whole selection finishes and subsequent edits are refused', async () => {
  const { app, files } = vault({ 'Review.md': 'before selected after' });
  const scope = { filePath: 'Review.md', text: 'selected', from: 7, sourceText: 'before selected after' };
  const first = await run(app, 'edit_document', { operation: 'find_replace', find: 'selected', content: '' }, scope);
  assert.equal(first.isError, false);
  assert.equal(files.get('Review.md'), 'before  after');
  const second = await run(app, 'edit_document', { operation: 'find_replace', find: 'after', content: 'oops' }, scope);
  assert.equal(second.isError, true);
  assert.equal(files.get('Review.md'), 'before  after');
});

test('A failed vault write leaves the selection tracking unchanged for a retry', async () => {
  const original = 'before selected after';
  const { app, files } = vault({ 'Review.md': original });
  const scope = { filePath: 'Review.md', text: 'selected', from: 7, sourceText: original };
  const before = { ...scope };
  const process = app.vault.process;
  app.vault.process = async (file, fn) => { fn(files.get(file.path)); throw new Error('write failed'); };
  const input = { operation: 'find_replace', find: 'selected', content: 'done' };
  assert.equal((await run(app, 'edit_document', input, scope)).isError, true);
  assert.deepEqual(scope, before);
  app.vault.process = process;
  assert.equal((await run(app, 'edit_document', input, scope)).isError, false);
  assert.equal(files.get('Review.md'), 'before done after');
});


test('Removing an adjacent identical selection is ambiguous and cannot edit its neighbour', async () => {
  const original = 'tasktask';
  const { app, files } = vault({ 'Review.md': 'task' });
  const scope = { filePath: 'Review.md', text: 'task', from: 0, sourceText: original };
  assert.equal((await run(app, 'edit_document', { operation: 'find_replace', find: 'task', content: 'DONE' }, scope)).isError, true);
  assert.equal(files.get('Review.md'), 'task');
});

test('CRLF additions before a repeated selection relocate from the original editor offset', async () => {
  const original = 'task\nheading\ntask\n';
  const changed = 'intro\n' + original;
  const { app, files } = vault({ 'Review.md': changed.replace(/\n/g, '\r\n') });
  const scope = { filePath: 'Review.md', text: 'task', from: original.lastIndexOf('task'), sourceText: original };
  assert.equal((await run(app, 'edit_document', { operation: 'find_replace', find: 'task', content: 'DONE' }, scope)).isError, false);
  assert.equal(files.get('Review.md'), 'intro\r\ntask\r\nheading\r\nDONE\r\n');
});
