# Chat-saving integration validation

This document records the scope, evidence, and remaining release gates for integrating Thomas Schierl's PR #10.

## Source and attribution

The integration branch preserves Thomas Schierl's original commits `4636fd3` and `a7574ec` through a merge. LICENSE and README credit his chat-saving implementation and shared test harness. The integration PR is [#11](https://github.com/o1xhack/obsidian-chatting/pull/11).

Plugin identity, provider authentication, settings defaults, the 1.11.4 minimum Obsidian version, and the existing `obsidian-chatting` migration are retained. This change does not import the rest of the fork.

## Regression evidence

- Main: seven of the eight incoming persistence tests fail; the legacy-file test passes.
- Incoming PR: all eight persistence tests pass.
- Integration: all 81 tests pass, including five additional recovery scenarios, cross-bundle reload coordination, and protection from an unloaded view's late save.
- TypeScript, Svelte (zero errors and warnings), production build, and diff checks pass.
- A separate test with production modules and a real APFS filesystem verifies old-format restore, matching two-copy saves, truncated-main recovery, and an old-version write surviving reupgrade. Its Obsidian host is mocked; this is filesystem evidence, not native-app or phone evidence.

The new coverage includes malformed state and history entries, a lone unreadable backup, equal millisecond/clock rollback ordering, old-version writes with tied mtimes, a freshly imported plugin bundle waiting for the old instance's queued unload save, and rejection of later saves from an unloaded instance when a pending provider request finally returns.

## Recovery limits

Each save writes the backup and then the main file. An existing complete copy can recover an interrupted write; data that has not reached either copy cannot be guaranteed after process termination. If neither file is readable, both existing files are preserved before fresh saves. A failed preservation disables saving for that session.

After a downgrade, an untimestamped main file whose filesystem mtime is newer than or equal to the timestamped copy is authoritative. Equal mtimes are ambiguous on coarse filesystems; the conservative choice avoids resurrecting a stale conversation, but may retain the last complete main file rather than a newer backup during a first interrupted upgrade.

## Native desktop evidence (2026-10-10)

Obsidian 1.13.7 ran both the original 0.4.0 build and the integration build in an isolated SSD vault. Native commands exercised the real plugin instance and vault adapter. Upgrade, truncated-main recovery, downgrade writes, reupgrade, settings retention, and a complete test-window reload passed. The real chat UI displayed the restored message. Clearing through the UI persisted empty visible and API histories to both copies; another window reload kept the UI empty. No API request was sent. This is window-reload evidence, not a forced-process-crash test.

The installed integration main.js matched the production build SHA-256 `5a4abc3ee13a31868027c6f7124871226ae5bdebf3e0f2f5984624457a6fe0a8`. Stage reports are in [chat-saving-desktop-qa.json](chat-saving-desktop-qa.json). All 81 offline tests were rerun successfully, including mocked provider responses for Anthropic, OpenAI, and ChatGPT, tool-call replay, cancellation, and delayed-save protection. At that checkpoint, live provider access and physical iPhone behavior were unverified; the later OAuth test below adds live ChatGPT evidence.

## Live ChatGPT OAuth evidence (2026-10-10)

The user signed the isolated vault into ChatGPT and selected `gpt-6.1-sol`. The vault is now named **ob 插件测试**, located at `/Volumes/StudioSSD/Obsidian/ob 插件测试`. The original vault registration was retained through Obsidian's native rename/move actions so its SecretStorage login remained available.

The user-authorized copies of `10 Projects` and `30 Resources` contain 1,771 files (128,398,973 bytes), including attachments. No other main-vault directories or plugin configuration were copied. Check-like path names were excluded by policy; none occurred within the two selected trees. Every copied file was SHA-256 checked against its source, and no file shares an inode with its source. Both trees still match after live tests. The detailed private copy manifest stays in the test vault, outside this repository.

Real ChatGPT responses successfully listed project files, read a copied README template, created a QA note, and continued after a full test-window reload. Before rereading the QA file, the model recalled the previous marker and count. It then edited the QA note, set a frontmatter property, and read back the result. Stop returned the UI to an available input, and a subsequent real turn succeeded. Writes were confined to `QA/`. The final saved state and backup matched. See [chat-saving-oauth-qa.json](chat-saving-oauth-qa.json) for sanitized evidence; credentials, private note contents, and filename inventories are excluded.

Live Anthropic, OpenAI API-key access, physical iPhone, and forced-process-crash behavior remain unverified.

## Remaining release gates

- Physical iPhone persistence/restart verification. Device enumeration alone is not proof, and sim-use cannot drive App Store Obsidian.
- The final code commit `069ac1b` has passing CI, a completed clean Codex review (+1; all three findings resolved), and a completed Community branch scan with no errors. Documentation-only follow-up commits still receive fresh CI/review/Community checks before merge.
- Merge, post-merge main CI, separate 0.4.1 release preparation, asset verification, and formal Community release scan.

GOAL.md is the task progress record. No release is represented as complete by this document.

## Release review follow-up

PR #12 additionally validates nested visible-history fields before restoring: image arrays, attachment shapes and unique IDs, tool inputs/results, and required text for supported text messages. A malformed-image regression failed before the fix; all 83 tests pass afterward, including valid image/tool history round-trip coverage. Native automation for this newly found malformed-attachment case did not execute because CUA input remained unresponsive; the earlier native desktop/OAuth evidence is unchanged in scope.
