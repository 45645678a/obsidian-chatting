// Runs every test/*.test.mjs with the Node test runner. A script instead of a
// glob in package.json, because npm on Windows doesn't expand globs.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("test")
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `test/${name}`);

const { status } = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(status ?? 1);
