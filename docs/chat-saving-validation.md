# Chat-saving integration validation

This document records the scope, evidence, and remaining release gates for integrating Thomas Schierl's PR #10.

## Source and attribution

The integration branch preserves Thomas Schierl's original commits `4636fd3` and `a7574ec` through a merge. LICENSE and README credit his chat-saving implementation and shared test harness. The integration PR is [#11](https://github.com/o1xhack/obsidian-chatting/pull/11).

Plugin identity, provider authentication, settings defaults, the 1.11.4 minimum Obsidian version, and the existing `obsidian-chatting` migration are retained. This change does not import the rest of the fork.

## Regression evidence

- Main: seven of the eight incoming persistence tests fail; the legacy-file test passes.
- Incoming PR: all eight persistence tests pass.
- Integration: all 80 tests pass, including five additional recovery scenarios and cross-bundle reload coordination.
- TypeScript, Svelte (zero errors and warnings), production build, and diff checks pass.
- A separate test with production modules and a real APFS filesystem verifies old-format restore, matching two-copy saves, truncated-main recovery, and an old-version write surviving reupgrade. Its Obsidian host is mocked; this is filesystem evidence, not native-app or phone evidence.

The new coverage includes malformed state and history entries, a lone unreadable backup, equal millisecond/clock rollback ordering, old-version writes with tied mtimes, and a freshly imported plugin bundle waiting for the old instance's queued unload save.

## Recovery limits

Each save writes the backup and then the main file. An existing complete copy can recover an interrupted write; data that has not reached either copy cannot be guaranteed after process termination. If neither file is readable, both existing files are preserved before fresh saves. A failed preservation disables saving for that session.

After a downgrade, an untimestamped main file whose filesystem mtime is newer than or equal to the timestamped copy is authoritative. Equal mtimes are ambiguous on coarse filesystems; the conservative choice avoids resurrecting a stale conversation, but may retain the last complete main file rather than a newer backup during a first interrupted upgrade.

## Remaining release gates

- Native Obsidian desktop verification in an isolated vault: upgrade from 0.4.0, restore, reload, downgrade, and reupgrade. A local synthetic-only vault is prepared; its plugin trust prompt awaits user confirmation.
- Physical iPhone persistence/restart verification. Device enumeration alone is not proof, and sim-use cannot drive App Store Obsidian.
- Clean independent review, CI, and Community branch scan for the final head.
- Merge, post-merge main CI, separate 0.4.1 release preparation, asset verification, and formal Community release scan.

GOAL.md is the task progress record. No release is represented as complete by this document.
