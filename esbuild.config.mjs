import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import process from "process";
import { readFileSync, writeFileSync } from "node:fs";
import enhancements from "./enhancements/index.cjs";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [
    esbuildSvelte({
      compilerOptions: { css: "injected" },
      preprocess: sveltePreprocess(),
    }),
    {
      name: "study-enhancements",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return;
          try {
            const source = readFileSync("main.js", "utf8");
            const patched = enhancements.applyEnhancements(source, { production: prod });
            writeFileSync("main.js", patched, "utf8");
          } catch (error) {
            return { errors: [{ text: error.message }] };
          }
        });
      },
    },
  ],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
