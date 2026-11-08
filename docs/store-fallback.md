# M1 store fallback: immutable snapshots and commit journal

## Root cause

The DSH host filesystem sandbox rejects atomic replacement on refs data files:

```text
EPERM: operation not permitted, rename
  '…/refs/last-capture.json.<pid>.<ts>.tmp' -> '…/refs/last-capture.json'
```

The host-side probe confirmed that `open('w')` can create and overwrite, append works, `link()` and `mkdir()` work, while `rename()` and `unlink()` fail with `EPERM`. The old `writeFileAtomic` relied on writing a temporary file and renaming it over the destination, so batch capture could not persist its final marker. `writeBatch` previously caught every error and returned `false`, hiding the reason from the command path.

## Persistence strategy

For only `refs.json`, `quarantine.json`, `annotated.md`, and `last-capture.json`, writes use immutable snapshots and a checksummed append-only journal:

1. Choose a snapshot version from the journal tail (up to 512 bytes) and create `file.vN` exclusively (`open(..., 'wx')`), so an existing snapshot is never truncated. If an uncommitted orphan already occupies that version, choose a random 48-bit fallback version rather than probing every intervening number.
2. Write the full snapshot and close it. The write path does not fsync the snapshot or read it back after writing.
3. Append a newline-terminated `{version, sha256}` record to `file.journal`; this record is the commit point. Before appending, the writer checks the last byte. If the previous tail is unterminated, it appends NUL plus newline after that tail to make the torn record invalid, then appends the new complete JSON record.
4. Readers accept only complete newline-terminated records with a positive integer version and 64-character SHA-256. They inspect recent records from the journal tail and verify candidate snapshot hashes newest-first, skipping missing snapshots and mismatches so an older valid commit can be returned. When the tail is truncated and recent records yield no valid snapshot, the reader scans full history newest-first. If no journal commit is usable, the legacy canonical file remains readable; non-ENOENT snapshot read errors propagate.

A partial or uncommitted snapshot is never selected because it has no complete valid journal commit. The previous committed snapshot is not modified, and no rename/unlink is needed for these four files. Snapshot files accumulate because deletion is unavailable. Released lock generations also remain on disk, but are reused; generation count reflects peak concurrency rather than writes over time. Other files retain the temp+rename writer, but the shared writer also no longer fsyncs them; rename restrictions still apply, and these files do not gain the snapshot/journal fallback.

## Lock and error propagation

`withStoreLock` tries `.lock`, then `.lock.N` generations. A new generation is created exclusively with `open('wx+')`; an existing generation is inspected with `open('r+')`. Released generations are reused by overwriting the fixed-size record with a new held token and reading it back to confirm ownership. Release overwrites the record with `released`; unlink is not used, so files remain, but the count does not grow per operation. A stale held lock is reusable only when its PID is confirmed dead (`ESRCH`); lock metadata read/stat errors fail closed, and a live PID is never displaced merely due to age. Lock records are coordination metadata and are not fsynced.

`withStoreLock` is reentrant only within the same asynchronous call chain and resolved lock directory, tracked with `AsyncLocalStorage`; that call reuses its outer physical lock. Independent async chains in one process are serialized for their full local critical section by `serialize(lockDir)`, while separate processes contend for physical file-lock generations. Because `unlink` is denied, `.lock`, `.lock.1`, … remain on disk, but released generations are reused. The regression runs four writers through six rounds and checks the count remains one in each round; its 1ms test critical sections are not comparable to the user’s separate 40ms-per-writer benchmark.

**Durability limit:** `writeFileAtomic` no longer fsyncs snapshot files, journal records, or directories; the shared temp+rename path also no longer fsyncs its temporary file or directory. The journal is the logical commit point: an incomplete journal line is ignored and an invalid/missing snapshot is skipped, preserving the previous valid commit under the tested process-crash cases. Without file and directory fsync, sudden OS/power loss can lose or reorder data, so this is not power-loss durable. Schema migration backups in `src/store/io.ts` still use their separate exclusive-create-plus-sync path.

**Host mutation locking:** `/refs annotate`, remove, edit, and enrich now hold the same `.lock` generation across the fresh read-modify-write phase. Annotation/model generation and registry resolution stay outside the lock; after acquiring it, each operation reloads current state and applies results to current rows, preserving concurrent edits and additions. `writeStore` and `writeQuarantine` remain low-level unlocked writers; callers performing read-modify-write must hold `withStoreLock`. The snapshot/journal fallback guarantees complete individual file commits, not a multi-file transaction if the process crashes between separate table writes.

`writeBatch` holds the store lock and propagates persistence errors instead of swallowing them. It returns success only after the batch snapshot/journal commit completes. At the sole `/refs` callsite, `src/index.ts` catches a batch persistence error without marking the batch saved, keeps the normal capture summary and counters, and appends a separate `Batch persistence failed: …` result line. The message is sanitized to a single line (control characters and line separators replaced with spaces) and capped at 240 characters. The command result text is verified in code; rendering in the live GUI still requires the isolated host capture check.

## Migration compatibility

Legacy canonical refs files remain readable. Schema migration backups are made from the logical file contents (through the version resolver) and written with exclusive creation plus sync; collision paths receive numeric suffixes. This also preserves a versioned-only legacy store that has no canonical `refs.json` path.

## Verification

- Deterministic full-suite acceptance command: `npx vitest run --maxWorkers=1`. Default parallel execution is a load-sensitive performance observation; the user measured 350/354 tests passing with four 5-second stress-test timeouts after 94.73s under machine load. That is not evidence of a functional defect; do not raise test timeouts to suppress it. Earlier 3.79s/3.81s full runs are valid only with `--maxWorkers=1`.
- Write-path microbenchmark correction: user reran `node test/benchmark-writeFileAtomic.mjs` (Node v25.8.1, 986-byte payload, 2 warmups and 10 samples) and reported atomic **28.874ms** / plain IO **3.587ms**. Earlier local values **0.307ms / 0.050ms** are unreproducible and superseded; do not cite them as evidence. This closeout did not rerun the microbenchmark.
- Standalone store behavior: `/usr/bin/time -p npx vitest run test/store.test.ts --reporter=verbose` — **23/23 passed**, all per-case durations **0–7ms**, Vitest `Duration 202ms` (`tests 50ms`), shell `real 0.68`, `user 0.60`, `sys 0.22`. This meets the `<100ms` per-case threshold.
- Lock reuse: `test/lock.test.ts` has **9/9 tests**. Consecutive final full runs each emitted a 4-writer ×6-round local regression with one lock file in every round: run 1 **5.20–5.74ms**, run 2 **5.26–5.66ms**; test critical sections are 1ms and are not comparable to the user’s separate ~40ms-per-section benchmark, measured at 202–217ms/round with one lock file.
- Two consecutive final full single-worker runs: `npm run typecheck && /usr/bin/time -p npx vitest run --maxWorkers=1 && /usr/bin/time -p npx vitest run --maxWorkers=1`. Run 1 raw: `Test Files 26 passed (26)`; `Tests 354 passed (354)`; `Start at 21:00:58`; `Duration 3.79s (transform 237ms, setup 0ms, import 554ms, tests 644ms, environment 1ms)`; shell `real 4.38`, `user 4.14`, `sys 0.85`. Run 2 raw: `Test Files 26 passed (26)`; `Tests 354 passed (354)`; `Start at 21:01:03`; `Duration 3.81s (transform 217ms, setup 0ms, import 535ms, tests 649ms, environment 1ms)`; shell `real 4.28`, `user 4.20`, `sys 0.85`. Both exited 0 and have `Duration >= tests`.
- Current fourth-round full gate, actual command `npx vitest run --maxWorkers=1` (exit 0). Raw summary: `Test Files 26 passed (26)`; `Tests 354 passed (354)`; `Start at 09:26:44`; `Duration 3.69s (transform 241ms, setup 0ms, import 552ms, tests 657ms, environment 1ms)`.
- `npm run typecheck` — passed. Final `npm run build && node --check lib/client.js` — passed; `grep -c "jsx-runtime" lib/client.js` = **0**, `grep -c "choose" lib/client.js` = **0**. `git diff --check` — passed after the current documentation and AGENTS updates. Host capture is outside the current performance task; no personal refs were used.
