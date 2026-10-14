'use strict';
const vm = require('node:vm');
const { patchMath } = require('./patch-math.cjs');
const { patchReasoning } = require('./patch-reasoning.cjs');
const { patchStudy } = require('./patch-study.cjs');
const { patchCollapse } = require('./patch-collapse.cjs');
const { patchConversations } = require('./patch-conversations.cjs');
const { patchLibrary } = require('./patch-library.cjs');
const { patchFollowNote } = require('./patch-follow-note.cjs');

// These checked transformations target upstream 0.4.2 and deliberately fail
// when an expected anchor changes. Review them before updating upstream.
function applyEnhancements(source, { production = false } = {}) {
  let result = source;
  if (production && !result.includes('/* nosourcemap */')) result += '\n/* nosourcemap */';
  for (const patch of [patchMath, patchReasoning, patchStudy, patchCollapse,
    patchConversations, patchLibrary, patchFollowNote]) result = patch(result);
  new vm.Script(result, { filename: 'main.js' });
  return result;
}

module.exports = { applyEnhancements };
