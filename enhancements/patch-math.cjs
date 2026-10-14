'use strict';
const { normalizeChatMath } = require('./normalize-math.cjs');
const marker = '// Local math rendering compatibility fix, 2026-10-13.';

function patchMath(source) {
  if (source.includes(marker)) throw new Error('Math compatibility patch is already present.');
  const anchor = '  function markdown(node, text2) {';
  const call = '      import_obsidian8.MarkdownRenderer.render($$props.app, value, node, "", child2);';
  for (const text of [anchor, call]) {
    if (source.split(text).length !== 2) throw new Error('Upstream Markdown renderer changed; review the math patch.');
  }
  const helper = (marker + '\n' + normalizeChatMath.toString()).split('\n').map(line => '  ' + line).join('\n');
  const patchedCall = [
    '      const renderingChild = child2;',
    '      void import_obsidian8.MarkdownRenderer.render(',
    '        $$props.app, normalizeChatMath(value), node, "", renderingChild',
    '      ).then(() => {',
    '        if (child2 === renderingChild && node.isConnected &&',
    '            typeof import_obsidian8.finishRenderMath === "function") {',
    '          return import_obsidian8.finishRenderMath();',
    '        }',
    '      }).catch(error => {',
    '        console.error("Chatting with AI: Markdown rendering failed", error);',
    '      });',
  ].join('\n');
  return source.replace(anchor, () => helper + '\n' + anchor).replace(call, () => patchedCall);
}

module.exports = { patchMath, marker };
