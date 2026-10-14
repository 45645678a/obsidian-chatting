import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const manifest = json("manifest.json");
const pkg = json("package.json");
const lock = json("package-lock.json");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[""].version);
assert.equal(json("versions.json")[manifest.version], manifest.minAppVersion);
assert.equal(manifest.id, "chatting-with-ai");
assert.equal(manifest.isDesktopOnly, true);
for (const file of ["main.js", "styles.css", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) assert.ok(existsSync(file), file);
new Script(readFileSync("main.js", "utf8"), { filename: "main.js" });
for (const marker of ["normalizeChatMath(value)", "var chatReasoning=", "var studySupport=",
  "var chatConversations=", "var chatBookLibrary=", "followReadingNote()"])
  assert.ok(readFileSync("main.js", "utf8").includes(marker), `Missing enhancement: ${marker}`);

const files = [...new Set([
  ...execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean),
  "main.js", "manifest.json", "styles.css",
])];
const blockedName = /(^|\/)(?:data(?:\.[^.]+)?\.json|chat-state[^/]*\.json|conversations[^/]*\.json|debug\.log|\.env(?:\..*)?|\.npmrc)$/;
const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const issues = [];
for (const file of files) {
  if (blockedName.test(file)) issues.push(`${file}: prohibited personal-state filename`);
  if (!/\.(?:[cm]?js|ts|svelte|json|md|yml|yaml|css|sh|txt)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) issues.push(`${file}: possible secret (value omitted)`);
  if (/(?:[A-Z]:[\\/]+Users[\\/]|[A-Z]:[\\/]+[^\n"']*Documents[\\/])/.test(text)) issues.push(`${file}: machine-specific user path`);
}
assert.deepEqual(issues, [], "Release source review failed; inspect the listed files without printing credentials");
console.log(`Release checks passed: ${manifest.version}; ${files.length} candidate source files checked.`);
