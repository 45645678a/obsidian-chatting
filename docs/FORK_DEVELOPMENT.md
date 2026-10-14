# Developing this fork

## Layout and upstream base

- `src/` is the TypeScript/Svelte source from upstream 0.4.2.
- `enhancements/` contains the readable CommonJS source and tests for the local
  additions. It includes no Obsidian installation script and never opens a
  personal vault during a build or test.
- `styles.css` contains the upstream styles plus the fork's additional styles.
- `esbuild.config.mjs` bundles the upstream source and applies the checked
  transformations in `enhancements/index.cjs` after each successful build.

This post-build structure preserves the existing implementation while making
it reproducible from source. It is intentionally tied to upstream 0.4.2 and
the committed `package-lock.json`. Each transformation checks its expected
anchors and fails if they change; do not bypass a failed anchor when updating
upstream. Review and adapt the transformation or port the feature into the
TypeScript/Svelte implementation first.

## Commands

Use Node.js 22 and the committed lockfile:

```sh
npm ci
npm run check
npm run package
```

`npm test` runs a production build first, then the upstream tests and the
enhancement tests. Tests use synthetic fixtures and mocked provider calls;
they require no API key or running Obsidian instance. `npm run check` also
runs TypeScript, Svelte, metadata, and release-content checks.

`npm run dev` watches upstream TypeScript/Svelte files and applies the
enhancements to each resulting bundle. Restart the watcher after editing
CommonJS files in `enhancements/`.

## Release contents

`npm run package` writes `release-assets/`, including a ZIP with one
`chatting-with-ai/` directory, separate installation files, license notices,
and SHA-256 checksums. It uses an explicit allowlist; it does not copy a vault
or the contents of an installed plugin directory.

Keep `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`
consistent when changing a release version. Release tags use the manifest
version, without a `v` prefix. The plugin ID stays `chatting-with-ai` for
existing-data compatibility, so upstream and this fork cannot be installed
side by side in the same vault under that ID.

## Validation limits

Automated tests exercise math normalization, provider metadata, editing
permissions, selection boundaries, conversation persistence/routing, and
screen-capture behavior with mocks. They do not establish live provider
availability, mobile support, or end-to-end OAuth access for another account.
The existing enhanced runtime was used on Windows desktop; the fork's
release manifest is desktop-only because reading-pane capture requires
Electron APIs.
