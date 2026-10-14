'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeChatMath } = require('./normalize-math.cjs');

test('renders the exact peak-height formula and inline parameters from the reported answer', () => {
  const source = '在峰顶 \\(x=x_0\\)：\n\n\\[\nD_{\\mathrm{峰顶}}=n_0(A+B).\n\\]\n\n背景 \\(B\\) 估高一点，信号 \\(A\\) 就可以估低一点。';
  const expected = '在峰顶 $x=x_0$：\n\n$$\nD_{\\mathrm{峰顶}}=n_0(A+B).\n$$\n\n背景 $B$ 估高一点，信号 $A$ 就可以估低一点。';
  assert.equal(normalizeChatMath(source), expected);
  assert.equal(normalizeChatMath(expected), expected);
});

test('preserves TeX commands and matrix row separators', () => {
  const expression = String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`;
  assert.equal(normalizeChatMath('\\[\n'+expression+'\n\\]'), '$$\n'+expression+'\n$$');
});

test('keeps literal examples in ordinary fenced code and normalizes subsequent prose', () => {
  for (const marker of ['```', '~~~~']) {
    const code = marker+'markdown\n\\(x\\)\n\\[y\\]\n'+marker;
    assert.equal(normalizeChatMath(code+'\n\\(z\\)'), code+'\n$z$');
  }
});

test('a longer outer code fence protects inner triple-backtick examples', () => {
  const code = '````markdown\n```latex\n\\[x\\]\n```\n\\(y\\)\n````';
  assert.equal(normalizeChatMath(code+'\n\\(z\\)'), code+'\n$z$');
});

test('preserves indented code and blockquoted fences', () => {
  for (const code of ['    \\(x\\)\n', '\t\\[x\\]\n', '> ```md\n> \\(x\\)\n> ```\n']) {
    assert.equal(normalizeChatMath(code+'\\(z\\)'), code+'$z$');
  }
});

test('preserves single and multiple-backtick inline code', () => {
  const code = '`\\(x\\)` and ``literal ` \\[y\\]``';
  assert.equal(normalizeChatMath(code+' and \\(z\\)'), code+' and $z$');
});

test('leaves existing dollar-delimited math untouched', () => {
  const source = String.raw`$x_0$ and $$\text{literal \(x\)}$$ and \(y\)`;
  assert.equal(normalizeChatMath(source), String.raw`$x_0$ and $$\text{literal \(x\)}$$ and $y$`);
});

test('leaves ordinary brackets, currency and escaped delimiters alone', () => {
  const source = String.raw`[链接](https://example.com) (A+B) $20 \\(literal\\) \\[literal\\]`;
  assert.equal(normalizeChatMath(source), source);
});

test('preserves incomplete, empty and multiline inline formulas', () => {
  for (const source of ['\\(unfinished', '\\[unfinished', '\\( \\)', '\\[ \\]', '\\(x\ny\\)']) {
    assert.equal(normalizeChatMath(source), source);
  }
});

test('preserves unterminated code fences during partial rendering', () => {
  const source = '```md\n\\(literal\\)\n\\[literal\\]';
  assert.equal(normalizeChatMath(source), source);
});

test('trims delimiter padding without changing expression content', () => {
  assert.equal(normalizeChatMath('\\( x_0 \\)'), '$x_0$');
  assert.equal(normalizeChatMath('\\[ A + B \\]'), '$$\nA + B\n$$');
});
