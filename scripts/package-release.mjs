import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

execFileSync(process.execPath, ["scripts/check-release.mjs"], { stdio: "inherit" });
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const allowlist = ["main.js", "manifest.json", "styles.css", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"];
const output = "release-assets";
mkdirSync(output, { recursive: true });

// A small, deterministic ZIP writer: stored entries, UTF-8 names, fixed dates.
// Keeping packaging dependency-free also makes the release allowlist explicit.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const local = [], central = [];
let offset = 0;
for (const file of allowlist) {
  const data = readFileSync(file), name = Buffer.from(`${manifest.id}/${file}`), crc = crc32(data);
  copyFileSync(file, join(output, file));
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6);
  h.writeUInt16LE(33, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14); c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  local.push(h, name, data); central.push(c, name); offset += h.length + name.length + data.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(allowlist.length, 8); end.writeUInt16LE(allowlist.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zipName = `${manifest.id}-${manifest.version}.zip`;
writeFileSync(join(output, zipName), Buffer.concat([...local, directory, end]));
const checksums = [...allowlist, zipName].map(file => `${createHash("sha256").update(readFileSync(join(output, file))).digest("hex")}  ${file}`);
writeFileSync(join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`Packaged ${zipName}: ${allowlist.length} allowlisted files and SHA-256 checksums.`);
