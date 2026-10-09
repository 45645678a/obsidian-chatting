// Vault tools through the real executor: the date for daily notes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api } from './harness.mjs';

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
