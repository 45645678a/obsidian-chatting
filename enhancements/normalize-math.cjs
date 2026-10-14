'use strict';

/**
 * Adapt AI TeX delimiters for Obsidian, only at display time.
 * Preserve code examples, existing dollar-delimited math, and escaped slashes.
 * Keep this function self-contained: patch-math.cjs embeds it in the plugin.
 */
function normalizeChatMath(source) {
  function escapedAt(position) {
    let slashes = 0;
    while (position > 0 && source[--position] === '\\') slashes++;
    return slashes % 2 === 1;
  }

  function findClosing(token, from, exactRun = false) {
    let position = source.indexOf(token, from);
    while (position !== -1) {
      const sameRun = exactRun &&
        (source[position - 1] === token[0] || source[position + token.length] === token[0]);
      if (!sameRun && !escapedAt(position)) return position;
      position = source.indexOf(token, position + token.length);
    }
    return -1;
  }

  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    if (cursor === 0 || source[cursor - 1] === '\n') {
      const opening = source.slice(cursor).match(/^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/);
      if (opening) {
        const marker = opening[1];
        let end = cursor + opening[0].length;
        while (end < source.length) {
          const newline = source.indexOf('\n', end);
          const next = newline === -1 ? source.length : newline + 1;
          const line = source.slice(end, next).replace(/^[ \t]*(?:>[ \t]*)*/, '').trimEnd();
          end = next;
          if (line.length >= marker.length && [...line].every(char => char === marker[0])) break;
        }
        output += source.slice(cursor, end);
        cursor = end;
        continue;
      }
      // Ordinary indented code must also keep its literal TeX examples.
      if (/^(?: {4}|\t)/.test(source.slice(cursor))) {
        const newline = source.indexOf('\n', cursor);
        const end = newline === -1 ? source.length : newline + 1;
        output += source.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    if (source[cursor] === '`') {
      const marker = source.slice(cursor).match(/^`+/)[0];
      const closing = findClosing(marker, cursor + marker.length, true);
      if (closing !== -1) {
        output += source.slice(cursor, closing + marker.length);
        cursor = closing + marker.length;
        continue;
      }
      output += marker;
      cursor += marker.length;
      continue;
    }

    if (source[cursor] === '$') {
      const marker = source[cursor + 1] === '$' ? '$$' : '$';
      const closing = findClosing(marker, cursor + marker.length, true);
      if (closing !== -1) {
        output += source.slice(cursor, closing + marker.length);
        cursor = closing + marker.length;
        continue;
      }
    }

    if (source[cursor] === '\\') {
      const next = source[cursor + 1];
      if (next === '(' || next === '[') {
        const closingToken = next === '(' ? '\\)' : '\\]';
        const closing = findClosing(closingToken, cursor + 2);
        if (closing !== -1) {
          const expression = source.slice(cursor + 2, closing);
          const trimmed = expression.trim();
          if (trimmed && (next === '[' || !/[\r\n]/.test(expression))) {
            output += next === '[' ? '$$\n' + trimmed + '\n$$' : '$' + trimmed + '$';
            cursor = closing + 2;
            continue;
          }
        }
      }
      // Consuming a full escape also prevents \\( or \\[ becoming formulas.
      output += source.slice(cursor, cursor + 2);
      cursor += 2;
      continue;
    }

    output += source[cursor++];
  }
  return output;
}

module.exports = { normalizeChatMath };
