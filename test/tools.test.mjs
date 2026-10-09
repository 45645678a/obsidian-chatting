// Vault tools through the real executor: the date for daily notes and
// set_properties input checks. Also how a selection scope reaches the model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, callbacks, response, settings, text, transport, vaultApp } from './harness.mjs';

const run = (app, name, input = {}) => api.executeTool(app, name, input, async () => 'yes');

test('get_current_datetime gives the local date, not the UTC one, near midnight', async () => {
  const RealDate = globalThis.Date;
  const zone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  // 23:30 on 5 October in Los Angeles is already 6 October in UTC.
  const instant = RealDate.parse('2026-10-06T06:30:00Z');
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  try {
    const result = await run({}, 'get_current_datetime');
    assert.equal(result.isError, false);
    assert.match(result.result, /\nDate: 2026-10-05$/);
    assert.match(result.result, /ISO: 2026-10-06T06:30:00\.000Z/);
  } finally {
    globalThis.Date = RealDate;
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

test('A multi-line selection is quoted line by line', async () => {
  const requests = transport(() => response('anthropic', [text('OK')]));
  const agent = new api.AgentLoop(vaultApp().app, settings('anthropic'));
  await agent.run('Shorten this', callbacks(), { text: 'First line\nSecond line\r\n\nFourth', filePath: 'Notes/Draft.md' });
  const sent = requests[0].messages[0].content;
  assert.match(sent, /Selected text:\n> First line\n> Second line\n> \n> Fourth\n\nShorten this$/);
});

// A note with frontmatter `properties`, edited through processFrontMatter.
function propertiesVault(properties = {}) {
  const frontmatter = { ...properties };
  let edits = 0;
  const app = {
    workspace: { getActiveFile: () => null },
    vault: { getFileByPath: path => (path === 'Note.md' ? { path } : null) },
    fileManager: { processFrontMatter: async (file, fn) => { edits++; fn(frontmatter); } },
  };
  return { app, frontmatter, edits: () => edits };
}

test('set_properties refuses a list or a missing object and leaves the note alone', async () => {
  for (const properties of [['tag'], 'tag: x', undefined, null]) {
    const { app, frontmatter, edits } = propertiesVault({ keep: 1 });
    const result = await run(app, 'set_properties', { path: 'Note.md', properties });
    assert.equal(result.isError, true, JSON.stringify(properties));
    assert.match(result.result, /must be an object/);
    assert.equal(edits(), 0);
    assert.deepEqual(frontmatter, { keep: 1 });
  }
  const { app, frontmatter } = propertiesVault({ keep: 1, old: 'x' });
  const result = await run(app, 'set_properties', { path: 'Note.md', properties: { tags: ['a', 'b'], old: null } });
  assert.equal(result.isError, false);
  assert.deepEqual(frontmatter, { keep: 1, tags: ['a', 'b'] });
});
