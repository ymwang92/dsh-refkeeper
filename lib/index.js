import { $ as isValidIsbn13, A as candidateFromModel, C as emptyQuarantine, D as sortReferences, E as referenceIdentityKey, F as rankCandidates, G as formatAuthorName, I as sanitizeEvidence, J as stripMarkup, M as extractCandidates, P as mergeCandidates, Q as isValidIsbn10, S as StoreError, T as referenceId, f as EXPORT_EXTENSIONS, n as judgeCandidate, p as renderExport, w as emptyStore, x as REF_TYPES, y as usefulAnnotationText } from "./judge-hxjlRhmR.js";
import { createRequire } from "node:module";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
// src/core/scope.ts
/** Human-readable scope label for command output. */
function describeScope(scope) {
	switch (scope.kind) {
		case "turn": return "current turn";
		case "lastN": return `last ${String(scope.turns)} turn(s)`;
		default: return "whole conversation";
	}
}
/** Parse `--scope=turn|lastN|all` plus an optional `--turns=N`. */
function parseScope(scopeArg, turnsArg) {
	const kind = scopeArg === "" ? "turn" : scopeArg;
	if (kind === "turn") return { kind: "turn" };
	if (kind === "all") return { kind: "all" };
	if (kind === "lastN" || kind === "last-n" || kind === "turns") {
		const turns = turnsArg === "" ? 5 : /^[0-9]+$/u.test(turnsArg) ? Number(turnsArg) : NaN;
		if (!Number.isInteger(turns) || turns < 1 || turns > 500) return { error: `--turns must be an integer in 1..500 (got ${turnsArg === "" ? "(empty)" : turnsArg})` };
		return {
			kind: "lastN",
			turns
		};
	}
	return { error: `--scope must be turn | lastN | all (got ${scopeArg})` };
}
/**
* Resolve a scope against observed turn boundaries.
*
* `lastN` yields exactly N turns when the session has that many: the window
* starts at the `turn/start` of the (m - N)th entry, so N=1 means "the last
* turn only".
*/
function resolveScope(turnStarts, lastSeq, scope) {
	const total = turnStarts.length;
	if (lastSeq < 0) return {
		startSeq: 0,
		endSeq: 0,
		turns: 0,
		requestedTurns: -1,
		degraded: "no-turn-boundaries"
	};
	if (total === 0) return {
		startSeq: 0,
		endSeq: lastSeq,
		turns: 0,
		requestedTurns: scope.kind === "lastN" ? scope.turns : -1,
		degraded: "no-turn-boundaries"
	};
	switch (scope.kind) {
		case "all": return {
			startSeq: 0,
			endSeq: lastSeq,
			turns: total,
			requestedTurns: -1,
			degraded: ""
		};
		case "turn": return {
			startSeq: turnStarts[total - 1] ?? 0,
			endSeq: lastSeq,
			turns: 1,
			requestedTurns: -1,
			degraded: ""
		};
		case "lastN": {
			const want = scope.turns;
			if (want >= total) return {
				startSeq: turnStarts[0] ?? 0,
				endSeq: lastSeq,
				turns: total,
				requestedTurns: want,
				degraded: want > total ? "n-exceeds-total" : ""
			};
			return {
				startSeq: turnStarts[total - want] ?? 0,
				endSeq: lastSeq,
				turns: want,
				requestedTurns: want,
				degraded: ""
			};
		}
	}
}
// src/core/batch.ts
/**
* The last capture run, as a plain value.
*
* Two audiences share this shape, so it lives in `core/` with no Node imports:
* the host persists it next to the library and uses it as the default export
* scope, and the client panel renders it. A client plugin cannot register a
* Remote namespace and `CommandResult` carries text only, so the batch travels
* to the panel as one machine-readable marker line inside the command output.
*/
const BATCH_MARKER = "refkeeper-batch:";
function sanitizeFields(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	const text = (input) => {
		if (typeof input !== "string") return void 0;
		const clean = stripMarkup(input);
		return clean === "" ? void 0 : clean;
	};
	const plain = (input) => typeof input === "string" && input !== "" ? input : void 0;
	const title = text(raw["title"]) ?? "";
	const type = text(raw["type"]) ?? "journalArticle";
	const authors = Array.isArray(raw["authors"]) ? raw["authors"].map((author) => text(author)).filter((author) => author !== void 0) : [];
	const year = typeof raw["year"] === "number" ? raw["year"] : void 0;
	return {
		type,
		title,
		authors,
		...text(raw["containerTitle"]) === void 0 ? {} : { containerTitle: text(raw["containerTitle"]) },
		...year === void 0 ? {} : { year },
		...text(raw["volume"]) === void 0 ? {} : { volume: text(raw["volume"]) },
		...text(raw["issue"]) === void 0 ? {} : { issue: text(raw["issue"]) },
		...text(raw["pages"]) === void 0 ? {} : { pages: text(raw["pages"]) },
		...text(raw["publisher"]) === void 0 ? {} : { publisher: text(raw["publisher"]) },
		...text(raw["publisherPlace"]) === void 0 ? {} : { publisherPlace: text(raw["publisherPlace"]) },
		...text(raw["language"]) === void 0 ? {} : { language: text(raw["language"]) },
		...plain(raw["doi"]) === void 0 ? {} : { doi: plain(raw["doi"]) },
		...plain(raw["arxivId"]) === void 0 ? {} : { arxivId: plain(raw["arxivId"]) },
		...plain(raw["pmid"]) === void 0 ? {} : { pmid: plain(raw["pmid"]) },
		...plain(raw["pmcid"]) === void 0 ? {} : { pmcid: plain(raw["pmcid"]) },
		...plain(raw["isbn"]) === void 0 ? {} : { isbn: plain(raw["isbn"]) },
		...plain(raw["reportNumber"]) === void 0 ? {} : { reportNumber: plain(raw["reportNumber"]) },
		...plain(raw["lccn"]) === void 0 ? {} : { lccn: plain(raw["lccn"]) },
		...plain(raw["oclc"]) === void 0 ? {} : { oclc: plain(raw["oclc"]) },
		...plain(raw["openlibraryId"]) === void 0 ? {} : { openlibraryId: plain(raw["openlibraryId"]) },
		...plain(raw["url"]) === void 0 ? {} : { url: plain(raw["url"]) }
	};
}
/** Keep only the fields the panel and the export scope actually read. */
function sanitizeEntry(entry) {
	if (typeof entry !== "object" || entry === null) return void 0;
	const raw = entry;
	const status = raw["status"];
	if (status !== "saved" && status !== "quarantined" && status !== "skipped" && status !== "failed") return;
	const text = (value) => {
		if (typeof value !== "string") return void 0;
		const clean = stripMarkup(value);
		return clean === "" ? void 0 : clean;
	};
	const id = typeof raw["id"] === "string" && raw["id"] !== "" ? raw["id"] : void 0;
	const doi = typeof raw["doi"] === "string" && raw["doi"] !== "" ? raw["doi"] : void 0;
	const arxivId = typeof raw["arxivId"] === "string" && raw["arxivId"] !== "" ? raw["arxivId"] : void 0;
	const pmid = typeof raw["pmid"] === "string" && raw["pmid"] !== "" ? raw["pmid"] : void 0;
	const pmcid = typeof raw["pmcid"] === "string" && raw["pmcid"] !== "" ? raw["pmcid"] : void 0;
	const reason = text(raw["reason"]);
	const title = text(raw["title"]) ?? "";
	const year = typeof raw["year"] === "number" ? raw["year"] : void 0;
	const fields = sanitizeFields(raw["fields"]);
	const annotated = raw["annotated"] === true;
	return {
		title,
		status,
		...fields === void 0 ? {} : { fields },
		...annotated ? { annotated: true } : {},
		...id === void 0 ? {} : { id },
		...doi === void 0 ? {} : { doi },
		...arxivId === void 0 ? {} : { arxivId },
		...pmid === void 0 ? {} : { pmid },
		...pmcid === void 0 ? {} : { pmcid },
		...reason === void 0 ? {} : { reason },
		...year === void 0 ? {} : { year }
	};
}
/** Tolerant parse: a corrupt batch degrades the panel, never capture. */
function normalizeBatch(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const raw = value;
	if (!Array.isArray(raw["entries"])) return void 0;
	const entries = [];
	for (const entry of raw["entries"]) {
		const clean = sanitizeEntry(entry);
		if (clean !== void 0) entries.push(clean);
	}
	return {
		capturedAt: typeof raw["capturedAt"] === "string" ? raw["capturedAt"] : "",
		scope: typeof raw["scope"] === "string" ? raw["scope"] : "",
		entries
	};
}
/** Entries that exist in a table and may therefore be exported. */
function exportableOf(batch, includeQuarantine) {
	return batch.entries.filter((entry) => entry.id !== void 0 && entry.id !== "").filter((entry) => entry.status === "saved" || includeQuarantine && entry.status === "quarantined").map((entry) => entry.id);
}
/** One transcript line carrying the batch for the client panel. */
function encodeBatch(batch) {
	return `${BATCH_MARKER} ${JSON.stringify(batch)}`;
}
// src/store/atomic.ts
const LOCK_STALE_MS = 3e4;
const LOCK_TIMEOUT_MS = 5e3;
const LOCK_RETRY_MS = 20;
const LOCK_RECORD_BYTES = 256;
const JOURNAL_TAIL_BYTES = 512;
const heldLockDirectories = new AsyncLocalStorage();
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
function digest(data) {
	return createHash("sha256").update(data, "utf8").digest("hex");
}
function journalPath(file) {
	return `${file}.journal`;
}
function snapshotPath(file, version) {
	return `${file}.v${String(version)}`;
}
function parseJournal(text) {
	const records = [];
	const lines = text.split("\n");
	if (!text.endsWith("\n")) lines.pop();
	for (const line of lines) {
		if (line.trim() === "") continue;
		try {
			const parsed = JSON.parse(line);
			if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "number" && Number.isSafeInteger(parsed.version) && parsed.version > 0 && "sha256" in parsed && typeof parsed.sha256 === "string" && /^[a-f0-9]{64}$/u.test(parsed.sha256)) records.push({
				version: parsed.version,
				sha256: parsed.sha256
			});
		} catch {}
	}
	return records;
}
async function journalRecords(file) {
	try {
		return parseJournal(await readFile(journalPath(file), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}
async function journalTailRecords(file) {
	let handle;
	try {
		handle = await open(journalPath(file), "r");
	} catch (error) {
		if (error.code === "ENOENT") return {
			records: [],
			complete: true
		};
		throw error;
	}
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, JOURNAL_TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = length === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, length, size - length);
		const records = parseJournal(buffer.toString("utf8", 0, bytesRead));
		if (records.length === 0 && size > length) return {
			records: await journalRecords(file),
			complete: true
		};
		return {
			records,
			complete: size <= length
		};
	} finally {
		await handle.close();
	}
}
async function readCommittedSnapshot(file, records) {
	for (const record of [...records].reverse()) try {
		const data = await readFile(snapshotPath(file, record.version), "utf8");
		if (digest(data) === record.sha256) return data;
	} catch (error) {
		if (error.code === "ENOENT") continue;
		throw error;
	}
}
/** Read a logical store file, resolving its latest complete immutable version.
*
* Existing canonical files remain readable for migration/backward compatibility.
* The normal read inspects only a bounded journal tail; the complete journal is
* read only if recent snapshots fail validation and older commits are needed.
*/
async function readFileAtomic(file) {
	const tail = await journalTailRecords(file);
	const recent = await readCommittedSnapshot(file, tail.records);
	if (recent !== void 0) return recent;
	if (!tail.complete) {
		const fallback = await readCommittedSnapshot(file, await journalRecords(file));
		if (fallback !== void 0) return fallback;
	}
	return readFile(file, "utf8");
}
const snapshotFallbackPaths = /* @__PURE__ */ new Set();
var AtomicRenameFailure = class extends Error {
	constructor(file, error) {
		super(`cannot rename ${file}: ${error instanceof Error ? error.message : String(error)}`);
		this.name = "AtomicRenameFailure";
	}
};
async function writeWithRename(file, data) {
	const tmp = `${file}.${String(process.pid)}.${String(Date.now())}.tmp`;
	let handle;
	try {
		handle = await open(tmp, "w");
		await handle.writeFile(data, "utf8");
		await handle.close();
		handle = void 0;
	} catch (error) {
		await handle?.close().catch(() => void 0);
		await rm(tmp, { force: true }).catch(() => void 0);
		throw new StoreError("write-failed", `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		await rename(tmp, file);
	} catch (error) {
		await rm(tmp, { force: true }).catch(() => void 0);
		throw new AtomicRenameFailure(file, error);
	}
}
/** Persist a file version as an immutable snapshot and append a checksummed commit record.
*
* This is the fallback used only after atomic rename fails for a file path. Until
* the journal record is complete, the previous committed version remains visible.
* Uncommitted snapshots are retained because unlink is forbidden.
*/
async function appendJournalRecord(file, record) {
	const handle = await open(journalPath(file), "a+");
	try {
		const { size } = await handle.stat();
		let separator = "";
		if (size > 0) {
			const lastByte = Buffer.alloc(1);
			const { bytesRead } = await handle.read(lastByte, 0, 1, size - 1);
			if (bytesRead !== 1 || lastByte[0] !== 10) separator = "\0\n";
		}
		const entry = `${separator}${JSON.stringify(record)}\n`;
		await handle.writeFile(entry, "utf8");
	} finally {
		await handle.close();
	}
}
async function writeFileAtomic(file, data) {
	const resolvedPath = resolve(file);
	const dir = dirname(file);
	await mkdir(dir, { recursive: true });
	await serialize(file, async () => {
		if (!snapshotFallbackPaths.has(resolvedPath)) try {
			await writeWithRename(file, data);
			return;
		} catch (error) {
			if (!(error instanceof AtomicRenameFailure)) throw error;
			snapshotFallbackPaths.add(resolvedPath);
		}
		const tail = await journalTailRecords(file);
		let version = Math.max(0, ...tail.records.map((record) => record.version)) + 1;
		let snapshot;
		let handle;
		for (;;) {
			snapshot = snapshotPath(file, version);
			try {
				handle = await open(snapshot, "wx");
				break;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
				version = randomInt(1, 2 ** 48);
			}
		}
		try {
			await handle.writeFile(data, "utf8");
		} catch (error) {
			await handle.close().catch(() => void 0);
			throw new StoreError("write-failed", `cannot write ${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
		await handle.close();
		try {
			await appendJournalRecord(file, {
				version,
				sha256: digest(data)
			});
		} catch (error) {
			throw new StoreError("write-failed", `cannot commit ${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}
function lockName(dir, generation) {
	return join(dir, generation === 0 ? ".lock" : `.lock.${String(generation)}`);
}
function lockContent(record) {
	const serialized = JSON.stringify(record);
	if (Buffer.byteLength(serialized, "utf8") > LOCK_RECORD_BYTES) throw new Error("lock record exceeds fixed-size limit");
	return serialized.padEnd(LOCK_RECORD_BYTES, " ");
}
function parseLockRecord(content) {
	if (content === void 0) return void 0;
	try {
		const parsed = JSON.parse(content.trim());
		if (typeof parsed === "object" && parsed !== null && "state" in parsed && (parsed.state === "held" || parsed.state === "released") && "pid" in parsed && typeof parsed.pid === "number" && "token" in parsed && typeof parsed.token === "string" && "at" in parsed && typeof parsed.at === "string") return {
			state: parsed.state,
			pid: parsed.pid,
			token: parsed.token,
			at: parsed.at
		};
	} catch {}
}
function processIsAlive(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
async function readLockContent(handle) {
	const buffer = Buffer.alloc(LOCK_RECORD_BYTES);
	const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
	return buffer.toString("utf8", 0, bytesRead);
}
async function lockIsReusable(handle, staleMs) {
	const [info, content] = await Promise.all([handle.stat(), readLockContent(handle)]);
	const record = parseLockRecord(content);
	if (record?.state === "released") return true;
	if (Date.now() - info.mtimeMs <= staleMs) return false;
	if (record?.state === "held" && processIsAlive(record.pid)) return false;
	return true;
}
async function writeLockContent(handle, content) {
	const { bytesWritten } = await handle.write(content, 0, "utf8");
	if (bytesWritten !== Buffer.byteLength(content, "utf8")) throw new Error("short lock record write");
}
async function markReleased(handle, token) {
	await writeLockContent(handle, lockContent({
		state: "released",
		pid: process.pid,
		token,
		at: (/* @__PURE__ */ new Date()).toISOString()
	}));
}
async function acquireLock(dir, staleMs) {
	for (let generation = 0;; generation += 1) {
		const path = lockName(dir, generation);
		let handle;
		let created = false;
		try {
			handle = await open(path, "wx+");
			created = true;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			try {
				handle = await open(path, "r+");
			} catch (openError) {
				if (openError.code === "ENOENT") continue;
				throw openError;
			}
			try {
				if (!await lockIsReusable(handle, staleMs)) {
					await handle.close();
					return;
				}
			} catch (readError) {
				await handle.close().catch(() => void 0);
				throw readError;
			}
		}
		const token = `${String(process.pid)}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
		try {
			const content = lockContent({
				state: "held",
				pid: process.pid,
				token,
				at: (/* @__PURE__ */ new Date()).toISOString()
			});
			await writeLockContent(handle, content);
			const confirmed = parseLockRecord(await readLockContent(handle));
			if (confirmed?.state !== "held" || confirmed.token !== token) {
				await handle.close();
				if (confirmed?.state === "held") return void 0;
				continue;
			}
			return {
				path,
				handle,
				token
			};
		} catch (error) {
			if (created) await markReleased(handle, token).catch(() => void 0);
			await handle.close().catch(() => void 0);
			throw new StoreError("write-failed", `cannot write store lock ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
/** Run `fn` while holding an exclusive generation lock in `refs/`.
*
* The host denies rename/unlink, so release overwrites this lock's fixed-size
* record with `state: released`. Released generations are reclaimed in place
* after the token is checked, preventing unbounded lock-file growth. Lock
* records are coordination metadata, so writes are verified but not fsynced.
*/
async function withStoreLock(dir, fn, options = {}) {
	const lockDir = resolve(dir);
	const inheritedLocks = heldLockDirectories.getStore();
	if (inheritedLocks?.has(lockDir) === true) return await fn();
	return await serialize(lockDir, async () => {
		const staleMs = options.staleMs ?? LOCK_STALE_MS;
		const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
		const retryMs = options.retryMs ?? LOCK_RETRY_MS;
		await mkdir(lockDir, { recursive: true });
		const started = Date.now();
		let held;
		while (held === void 0) {
			held = await acquireLock(lockDir, staleMs);
			if (held !== void 0) break;
			if (Date.now() - started > timeoutMs) throw new StoreError("lock-timeout", `refs store is locked by another process (${join(lockDir, ".lock")})`);
			await sleep(retryMs);
		}
		const activeLocks = new Set(inheritedLocks);
		activeLocks.add(lockDir);
		try {
			return await heldLockDirectories.run(activeLocks, fn);
		} finally {
			activeLocks.delete(lockDir);
			try {
				await markReleased(held.handle, held.token);
			} finally {
				await held.handle.close().catch(() => void 0);
			}
		}
	});
}
const queues = /* @__PURE__ */ new Map();
/** Serialize operations on one store within this process. */
function serialize(key, fn) {
	const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
	queues.set(key, next.catch(() => void 0));
	return next;
}
// src/store/annotated.ts
const TYPE_LABEL = {
	journalArticle: "Journal articles",
	conferencePaper: "Conference papers",
	preprint: "Preprints",
	report: "Reports",
	thesis: "Theses",
	book: "Books",
	webpage: "Web pages"
};
function formatAuthor(author) {
	if (author.literal) return author.literal;
	const family = author.family ?? "";
	const given = author.given ?? "";
	if (family && given) return `${family} ${given}`;
	return family || given;
}
function authorLine(ref) {
	const names = ref.authors.map(formatAuthor).filter((name) => name !== "");
	if (names.length === 0) return "n.a.";
	if (names.length <= 3) return names.join("; ");
	return `${names.slice(0, 3).join("; ")} et al.`;
}
function statusSuffix(ref) {
	return ref.verification.status === "manual" ? " ⚑ manual" : "";
}
function metaLine(ref) {
	const parts = [authorLine(ref)];
	if (ref.year !== void 0) parts.push(String(ref.year));
	const container = [
		ref.containerTitle,
		ref.volume,
		ref.issue,
		ref.pages
	].filter((part) => typeof part === "string" && part !== "").join(" ");
	if (container) parts.push(container);
	const ids = [
		ref.identifiers.doi ? `DOI [${ref.identifiers.doi}](https://doi.org/${ref.identifiers.doi})` : "",
		ref.identifiers.arxiv ? `arXiv [${ref.identifiers.arxiv}](https://arxiv.org/abs/${ref.identifiers.arxiv})` : "",
		ref.identifiers.isbn ? `ISBN ${ref.identifiers.isbn}` : "",
		ref.identifiers.reportNumber ? `Report ${ref.identifiers.reportNumber}` : ""
	].filter((part) => part !== "");
	if (ids.length > 0) parts.push(ids.join(" · "));
	return parts.join(" · ");
}
function annotationBlock(ref) {
	const annotation = ref.annotation;
	if (!annotation) return [];
	const summary = usefulAnnotationText(annotation.summary);
	const relevance = usefulAnnotationText(annotation.relevance);
	const evidence = usefulAnnotationText(annotation.evidence);
	const caveats = usefulAnnotationText(annotation.caveats);
	const rows = [];
	if (summary !== "") rows.push(`**Summary** — ${summary}`);
	if (relevance !== "") rows.push(`**Why it matters** — ${relevance}`);
	if (evidence !== "") rows.push(`**Evidence** — ${evidence}`);
	if (caveats !== "") rows.push(`**Caveats** — ${caveats}`);
	if (rows.length === 0) return [];
	const provenance = annotation.source ? ` _(${annotation.source})_` : "";
	return [
		"",
		...rows.map((row) => `> ${row}`),
		provenance ? provenance.trim() : ""
	].filter((line, index, all) => !(line === "" && all[index - 1] === ""));
}
function verificationLine(ref) {
	const v = ref.verification;
	const passed = v.passed !== void 0 ? ` ${String(v.passed)}/3` : "";
	const sources = v.sources && v.sources.length > 0 ? ` · ${v.sources.join(", ")}` : "";
	const reasons = v.reasons && v.reasons.length > 0 ? ` · ${v.reasons.join(", ")}` : "";
	return `- verification: **${v.status}**${passed}${sources}${reasons}`;
}
function entryBlock(ref, index) {
	const lines = [
		`### ${String(index)}. ${ref.title}${statusSuffix(ref)}`,
		"",
		metaLine(ref),
		""
	];
	lines.push(...annotationBlock(ref));
	lines.push(verificationLine(ref));
	if (ref.tags && ref.tags.length > 0) lines.push(`- tags: ${ref.tags.join(", ")}`);
	return [...lines, ""];
}
/** Human-readable mirror of the store. Deterministic: no wall-clock timestamps,
* so regenerating an unchanged store produces identical bytes. */
function renderAnnotated(state, quarantine) {
	const lines = ["# Reference library", ""];
	const quarantined = quarantine?.entries.length ?? 0;
	lines.push(`${String(state.references.length)} reference(s)` + (quarantined > 0 ? ` · ${String(quarantined)} in ⚠ quarantine` : "") + ` · updated ${state.updatedAt}`);
	lines.push("");
	for (const type of REF_TYPES) {
		const group = state.references.filter((ref) => ref.type === type);
		if (group.length === 0) continue;
		lines.push(`## ${TYPE_LABEL[type]}`, "");
		group.forEach((ref, index) => {
			lines.push(...entryBlock(ref, index + 1));
		});
	}
	if (state.references.length === 0) lines.push("_No verified references yet._", "");
	if (quarantine && quarantine.entries.length > 0) {
		lines.push("## ⚠ Quarantine (excluded from export)", "");
		lines.push("Verification did not pass the three-condition gate. These entries are kept for review and are **never** exported by default.", "");
		quarantine.entries.forEach((ref, index) => {
			lines.push(...entryBlock(ref, index + 1));
		});
	}
	return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}
// src/store/io.ts
const REFS_DIRNAME = "refs";
function storePaths(workspace) {
	const dir = join(workspace, REFS_DIRNAME);
	return {
		dir,
		refs: join(dir, "refs.json"),
		quarantine: join(dir, "quarantine.json"),
		annotated: join(dir, "annotated.md"),
		exports: join(dir, "exports")
	};
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function isTrigger(value) {
	return value === "button" || value === "command" || value === "tool";
}
function num(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function authors(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const item of value) {
		if (typeof item === "string" && item.trim() !== "") {
			out.push({ literal: item.trim() });
			continue;
		}
		if (!isRecord$2(item)) continue;
		const family = str(item["family"]);
		const given = str(item["given"]);
		const literal = str(item["literal"]);
		const sequence = num(item["sequence"]);
		if (!family && !given && !literal) continue;
		out.push({
			...family ? { family } : {},
			...given ? { given } : {},
			...literal ? { literal } : {},
			...sequence !== void 0 ? { sequence } : {}
		});
	}
	return out;
}
/**
* Identity fields, accepted in two shapes on purpose:
*   `{ identifiers: { doi } }`  — the stored shape, used by tools and stores
*   `{ doi, arxivId }`          — the flat shape `/refs save` documents and the
*                                 panel sends, because a human types one DOI
* Mapping the flat shape here (rather than at each call site) means a payload
* cannot lose its DOI on the way in: an identity-less record dedupes by title
* and silently merges with a different paper that shares the year.
*/
function identifiers(raw) {
	const nested = isRecord$2(raw["identifiers"]) ? raw["identifiers"] : {};
	const out = {};
	for (const [from, to] of [
		["doi", "doi"],
		["arxiv", "arxiv"],
		["arxivId", "arxiv"],
		["pmid", "pmid"],
		["pmcid", "pmcid"],
		["isbn", "isbn"],
		["lccn", "lccn"],
		["oclc", "oclc"],
		["openlibraryId", "openlibraryId"],
		["reportNumber", "reportNumber"]
	]) {
		if (out[to] !== void 0) continue;
		const text = str(nested[from]) ?? str(raw[from]);
		if (text === void 0) continue;
		const normalized = to === "pmid" ? text.replace(/\s+/gu, "") : to === "pmcid" ? text.replace(/\s+/gu, "").toUpperCase() : to === "lccn" ? text.trim().toLowerCase() : to === "oclc" ? text.trim() : to === "openlibraryId" ? text.trim().toUpperCase() : text;
		if (normalized) out[to] = normalized;
	}
	return out;
}
/** Fill in the mandatory envelope so writers never depend on caller hygiene. */
function coerceReference(raw, now) {
	if (!isRecord$2(raw)) return void 0;
	const title = str(raw["title"]);
	if (!title) return void 0;
	const type = REF_TYPES.includes(raw["type"]) ? raw["type"] : "journalArticle";
	const ids = identifiers(raw);
	const year = num(raw["year"]);
	const addedAt = str(raw["addedAt"]) ?? now;
	const base = {
		title,
		year,
		identifiers: ids
	};
	const provenance = isRecord$2(raw["provenance"]) ? {
		...str(raw["provenance"]["sessionId"]) ? { sessionId: str(raw["provenance"]["sessionId"]) } : {},
		...num(raw["provenance"]["seqStart"]) !== void 0 ? { seqStart: num(raw["provenance"]["seqStart"]) } : {},
		...num(raw["provenance"]["seqEnd"]) !== void 0 ? { seqEnd: num(raw["provenance"]["seqEnd"]) } : {},
		...str(raw["provenance"]["scope"]) ? { scope: str(raw["provenance"]["scope"]) } : {},
		...str(raw["provenance"]["capturedAt"]) ? { capturedAt: str(raw["provenance"]["capturedAt"]) } : {},
		...isTrigger(raw["provenance"]["trigger"]) ? { trigger: raw["provenance"]["trigger"] } : {}
	} : { capturedAt: addedAt };
	const verification = isRecord$2(raw["verification"]) ? raw["verification"] : { status: "manual" };
	return {
		id: str(raw["id"]) ?? referenceId(base),
		type,
		...str(raw["language"]) ? { language: str(raw["language"]) } : {},
		title,
		...str(raw["containerTitle"]) ? { containerTitle: str(raw["containerTitle"]) } : {},
		authors: authors(raw["authors"]),
		...year !== void 0 ? { year } : {},
		...str(raw["volume"]) ? { volume: str(raw["volume"]) } : {},
		...str(raw["issue"]) ? { issue: str(raw["issue"]) } : {},
		...str(raw["pages"]) ? { pages: str(raw["pages"]) } : {},
		...str(raw["publisher"]) ? { publisher: str(raw["publisher"]) } : {},
		...str(raw["publisherPlace"]) ? { publisherPlace: str(raw["publisherPlace"]) } : {},
		identifiers: ids,
		...str(raw["url"]) ? { url: str(raw["url"]) } : {},
		...str(raw["accessed"]) ? { accessed: str(raw["accessed"]) } : {},
		provenance: {
			capturedAt: addedAt,
			...provenance
		},
		verification,
		...isRecord$2(raw["annotation"]) ? { annotation: raw["annotation"] } : {},
		...Array.isArray(raw["tags"]) ? { tags: raw["tags"].filter((t) => typeof t === "string") } : {},
		...str(raw["bibtexKey"]) ? { bibtexKey: str(raw["bibtexKey"]) } : {},
		addedAt,
		updatedAt: str(raw["updatedAt"]) ?? addedAt
	};
}
async function exists(file) {
	try {
		await readFileAtomic(file);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
function stamp$1(now) {
	return now.replace(/[:.]/gu, "-");
}
async function readJson(file) {
	const text = await readFileAtomic(file);
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new StoreError("corrupt-store", `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}
async function writeMigrationBackup(source, destination) {
	const contents = await readFileAtomic(source);
	let path = destination;
	let suffix = 0;
	for (;;) {
		let handle;
		try {
			handle = await open(path, "wx");
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			suffix += 1;
			path = `${destination}.${String(suffix)}`;
			continue;
		}
		try {
			await handle.writeFile(contents, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		return path;
	}
}
async function loadStore(workspace, options = {}) {
	const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
	const paths = storePaths(workspace);
	if (!await exists(paths.refs)) return {
		state: emptyStore(now),
		migrated: false,
		dropped: 0
	};
	const raw = await readJson(paths.refs);
	const legacy = Array.isArray(raw);
	const record = isRecord$2(raw) ? raw : void 0;
	const version = legacy ? 0 : num(record?.["schemaVersion"]) ?? 0;
	if (version > 1) throw new StoreError("unsupported-schema", `refs.json has schemaVersion ${String(version)}; this build understands up to ${String(1)}. Upgrade dsh-refkeeper.`);
	const list = legacy ? raw : Array.isArray(record?.["references"]) ? record["references"] : void 0;
	if (!list) throw new StoreError("corrupt-store", "refs.json has neither an array nor a `references` array");
	const seen = /* @__PURE__ */ new Map();
	let dropped = 0;
	for (const item of list) {
		const ref = coerceReference(item, now);
		if (!ref) {
			dropped += 1;
			continue;
		}
		seen.set(ref.id, ref);
	}
	const state = {
		schemaVersion: 1,
		updatedAt: now,
		references: sortReferences([...seen.values()])
	};
	if (version === 1) return {
		state,
		migrated: false,
		dropped
	};
	let backupPath = `${paths.refs}.bak-${stamp$1(now)}`;
	try {
		if (options.backup) await options.backup(paths.refs, backupPath);
		else backupPath = await writeMigrationBackup(paths.refs, backupPath);
	} catch (error) {
		throw new StoreError("backup-failed", `refusing to migrate refs.json: backup to ${backupPath} failed (${error instanceof Error ? error.message : String(error)})`);
	}
	return {
		state,
		migrated: true,
		backupPath,
		dropped
	};
}
async function loadQuarantine(workspace, options = {}) {
	const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
	const paths = storePaths(workspace);
	if (!await exists(paths.quarantine)) return emptyQuarantine(now);
	const raw = await readJson(paths.quarantine);
	const list = Array.isArray(raw) ? raw : isRecord$2(raw) && Array.isArray(raw["entries"]) ? raw["entries"] : void 0;
	if (!list) throw new StoreError("corrupt-store", "quarantine.json is not an array");
	const entries = [];
	for (const item of list) {
		const ref = coerceReference(item, now);
		if (ref) entries.push(ref);
	}
	return {
		schemaVersion: 1,
		updatedAt: now,
		entries
	};
}
function payload(updatedAt, key, list) {
	return `${JSON.stringify({
		schemaVersion: 1,
		updatedAt,
		[key]: list
	}, null, 2)}\n`;
}
async function writeStore(workspace, state) {
	const paths = storePaths(workspace);
	await writeFileAtomic(paths.refs, payload(state.updatedAt, "references", state.references));
	await writeFileAtomic(paths.annotated, renderAnnotated(state));
}
async function writeQuarantine(workspace, state) {
	await writeFileAtomic(storePaths(workspace).quarantine, payload(state.updatedAt, "entries", state.entries));
}
/** Append or replace one reference, holding both the in-process queue and the
* on-disk lock. Capacity is checked against the *main* table only. */
async function saveReference(workspace, input, options = {}) {
	const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
	const max = options.max ?? 5e3;
	const paths = storePaths(workspace);
	return serialize(`store:${paths.dir}`, () => withStoreLock(paths.dir, async () => {
		const { state } = await loadStore(workspace, { now });
		const identity = referenceIdentityKey(input);
		const existing = state.references.find((ref) => referenceIdentityKey(ref) === identity);
		if (!existing && state.references.length >= max) throw new StoreError("capacity", `refs store holds ${String(state.references.length)} references (limit ${String(max)}); export and archive before adding more.`);
		const merged = existing ? {
			...input,
			id: existing.id,
			annotation: input.annotation ?? existing.annotation,
			addedAt: existing.addedAt,
			updatedAt: now
		} : {
			...input,
			addedAt: input.addedAt || now,
			updatedAt: now
		};
		const references = sortReferences([...state.references.filter((ref) => referenceIdentityKey(ref) !== identity), merged]);
		const next = {
			schemaVersion: 1,
			updatedAt: now,
			references
		};
		await writeStore(workspace, next);
		const quarantine = await loadQuarantine(workspace, { now });
		const remaining = quarantine.entries.filter((ref) => referenceIdentityKey(ref) !== identity);
		if (remaining.length !== quarantine.entries.length) await writeQuarantine(workspace, {
			schemaVersion: 1,
			updatedAt: now,
			entries: remaining
		});
		return {
			reference: merged,
			state: next,
			replaced: Boolean(existing)
		};
	}));
}
async function saveQuarantined(workspace, input, options = {}) {
	const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
	const paths = storePaths(workspace);
	return serialize(`store:${paths.dir}`, () => withStoreLock(paths.dir, async () => {
		const [main, current] = await Promise.all([loadStore(workspace, { now }), loadQuarantine(workspace, { now })]);
		const identity = referenceIdentityKey(input);
		if (main.state.references.some((ref) => referenceIdentityKey(ref) === identity)) return {
			state: current,
			stored: false
		};
		const prior = current.entries.find((ref) => referenceIdentityKey(ref) === identity);
		const entries = [prior === void 0 ? input : {
			...input,
			verification: {
				...input.verification,
				reasons: [.../* @__PURE__ */ new Set([...input.verification.reasons ?? [], ...prior.verification.reasons ?? []])]
			}
		}, ...current.entries.filter((ref) => referenceIdentityKey(ref) !== identity)];
		const next = {
			schemaVersion: 1,
			updatedAt: now,
			entries
		};
		await writeQuarantine(workspace, next);
		return {
			state: next,
			stored: true
		};
	}));
}
/**
* Move selected quarantine rows into the main table under one process and disk lock.
* The main table is written before removing quarantine rows: an interrupted move
* can leave a duplicate, but never lose the only copy. Retrying deduplicates by id.
*/
async function promoteQuarantined(workspace, candidates, options = {}) {
	const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
	const max = options.max ?? 5e3;
	const paths = storePaths(workspace);
	return serialize(`store:${paths.dir}`, () => withStoreLock(paths.dir, async () => {
		const [main, quarantine] = await Promise.all([loadStore(workspace, { now }), loadQuarantine(workspace, { now })]);
		const quarantineById = new Map(quarantine.entries.map((ref) => [ref.id, ref]));
		const selected = candidates.map((candidate) => quarantineById.get(candidate.id)).filter((ref) => ref !== void 0);
		const existingById = new Map(main.state.references.map((ref) => [ref.id, ref]));
		const incoming = selected.map((ref) => {
			const candidate = candidates.find((item) => item.id === ref.id) ?? ref;
			const previous = existingById.get(ref.id);
			return previous === void 0 ? candidate : {
				...candidate,
				annotation: candidate.annotation ?? previous.annotation
			};
		});
		const additions = incoming.filter((ref) => !existingById.has(ref.id));
		const replaced = incoming.length - additions.length;
		if (main.state.references.length + additions.length > max) throw new StoreError("capacity", `refs store holds ${String(main.state.references.length)} references (limit ${String(max)}); export and archive before promoting more.`);
		if (selected.length === 0) return {
			promoted: [],
			skipped: candidates.length,
			replaced: 0
		};
		const selectedIds = new Set(selected.map((ref) => ref.id));
		await writeStore(workspace, {
			schemaVersion: 1,
			updatedAt: now,
			references: sortReferences([...main.state.references.filter((ref) => !selectedIds.has(ref.id)), ...incoming])
		});
		await writeQuarantine(workspace, {
			schemaVersion: 1,
			updatedAt: now,
			entries: quarantine.entries.filter((ref) => !selectedIds.has(ref.id))
		});
		return {
			promoted: incoming,
			skipped: candidates.length - selected.length,
			replaced
		};
	}));
}
// src/host/capture-batch.ts
const BATCH_FILENAME = "last-capture.json";
function batchPath(workspace) {
	return join(storePaths(workspace).dir, BATCH_FILENAME);
}
/** Never throws: a missing or corrupt batch must not break capture. */
async function readBatch(workspace) {
	let raw;
	try {
		raw = await readFileAtomic(batchPath(workspace));
	} catch {
		return;
	}
	try {
		return normalizeBatch(JSON.parse(raw));
	} catch {
		return;
	}
}
/** Persist the batch and propagate failures for a visible host notice. */
async function writeBatch(workspace, batch) {
	const dir = storePaths(workspace).dir;
	await withStoreLock(dir, async () => {
		await writeFileAtomic(batchPath(workspace), `${JSON.stringify(batch, null, 2)}\n`);
	});
	return true;
}
// src/host/capture-save.ts
function withRegistryMetadata(candidate, record) {
	return {
		...candidate,
		title: candidate.title.trim() === "" ? record.title.trim() : candidate.title,
		authors: candidate.authors.length > 0 ? candidate.authors : record.authors,
		year: candidate.year ?? record.year,
		container: candidate.container || record.container,
		volume: candidate.volume || (record.volume ?? ""),
		issue: candidate.issue || (record.issue ?? ""),
		pages: candidate.pages || (record.pages ?? ""),
		doi: candidate.doi || record.doi,
		url: candidate.url || record.url,
		needsModelEnrichment: record.title.trim() === "" || record.authors.length === 0 || record.year === void 0
	};
}
/** Flatten a stored record into the panel's editable field view. */
function fieldsOfReference(ref) {
	if (ref === void 0) return void 0;
	const display = (author) => stripMarkup(author.literal !== void 0 && author.literal !== "" ? author.literal : [author.family ?? "", author.given ?? ""].filter((part) => part !== "").join(", "));
	const authors = ref.authors.map(display).filter((author) => author !== "");
	return {
		type: ref.type,
		title: stripMarkup(ref.title),
		authors,
		...ref.containerTitle === void 0 ? {} : { containerTitle: stripMarkup(ref.containerTitle) },
		...ref.year === void 0 ? {} : { year: ref.year },
		...ref.volume === void 0 ? {} : { volume: ref.volume },
		...ref.issue === void 0 ? {} : { issue: ref.issue },
		...ref.pages === void 0 ? {} : { pages: ref.pages },
		...ref.publisher === void 0 ? {} : { publisher: stripMarkup(ref.publisher) },
		...ref.publisherPlace === void 0 ? {} : { publisherPlace: stripMarkup(ref.publisherPlace) },
		...ref.language === void 0 ? {} : { language: ref.language },
		...ref.identifiers.doi === void 0 ? {} : { doi: ref.identifiers.doi },
		...ref.identifiers.arxiv === void 0 ? {} : { arxivId: ref.identifiers.arxiv },
		...ref.identifiers.pmid === void 0 ? {} : { pmid: ref.identifiers.pmid },
		...ref.identifiers.pmcid === void 0 ? {} : { pmcid: ref.identifiers.pmcid },
		...ref.identifiers.isbn === void 0 ? {} : { isbn: ref.identifiers.isbn },
		...ref.identifiers.reportNumber === void 0 ? {} : { reportNumber: ref.identifiers.reportNumber },
		...ref.identifiers.lccn === void 0 ? {} : { lccn: ref.identifiers.lccn },
		...ref.identifiers.oclc === void 0 ? {} : { oclc: ref.identifiers.oclc },
		...ref.identifiers.openlibraryId === void 0 ? {} : { openlibraryId: ref.identifiers.openlibraryId },
		...ref.url === void 0 ? {} : { url: ref.url }
	};
}
function authorPayload(author) {
	const [family, ...given] = author.split(",");
	if (given.length === 0) return { literal: (family ?? "").trim() };
	return {
		family: (family ?? "").trim(),
		given: given.join(",").trim()
	};
}
/** Resolve bare identifiers before the standard verified-save path is called. */
async function saveCaptured(candidates, deps) {
	let saved = 0;
	let quarantined = 0;
	let skipped = 0;
	let failed = 0;
	const entries = [];
	for (const original of candidates) {
		let candidate = original;
		let registry;
		if (candidate.doi !== "" || candidate.arxivId !== "" || candidate.pmid !== void 0 && candidate.pmid !== "" || candidate.pmcid !== void 0 && candidate.pmcid !== "" || candidate.isbn !== "" || candidate.reportNumber !== "") try {
			const record = await deps.resolveIdentifier(candidate);
			if (record !== void 0) {
				registry = record;
				candidate = withRegistryMetadata(candidate, record);
			}
		} catch {}
		const identity = {
			title: candidate.title,
			...candidate.year === void 0 ? {} : { year: candidate.year },
			...candidate.doi === "" ? {} : { doi: candidate.doi },
			...candidate.arxivId === "" ? {} : { arxivId: candidate.arxivId },
			...candidate.pmid === void 0 || candidate.pmid === "" ? {} : { pmid: candidate.pmid },
			...candidate.pmcid === void 0 || candidate.pmcid === "" ? {} : { pmcid: candidate.pmcid }
		};
		if (candidate.title.trim() === "") {
			skipped += 1;
			entries.push({
				...identity,
				status: "skipped"
			});
			continue;
		}
		const payload = {
			title: candidate.title,
			authors: candidate.authors.map(authorPayload),
			year: candidate.year,
			type: candidate.type,
			doi: candidate.doi,
			arxivId: candidate.arxivId,
			pmid: candidate.pmid,
			pmcid: candidate.pmcid,
			isbn: candidate.isbn,
			lccn: candidate.lccn,
			oclc: candidate.oclc,
			openlibraryId: candidate.openlibraryId,
			reportNumber: candidate.reportNumber,
			url: candidate.url,
			containerTitle: candidate.container,
			volume: candidate.volume,
			issue: candidate.issue,
			pages: candidate.pages,
			publisher: registry?.publisher ?? "",
			language: registry?.language ?? "",
			provenance: {
				trigger: "button",
				capturedAt: deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString()
			}
		};
		try {
			const result = await deps.save(payload);
			if (result.kind === "error") {
				failed += 1;
				entries.push({
					...identity,
					status: "failed",
					...result.reason === void 0 ? {} : { reason: result.reason }
				});
			} else if (result.quarantined === true) {
				quarantined += 1;
				entries.push({
					...identity,
					status: "quarantined",
					...result.id === void 0 ? {} : { id: result.id },
					...result.reason === void 0 ? {} : { reason: result.reason },
					...result.fields === void 0 ? {} : { fields: result.fields }
				});
			} else {
				saved += 1;
				entries.push({
					...identity,
					status: "saved",
					...result.id === void 0 ? {} : { id: result.id },
					...result.reason === void 0 ? {} : { reason: result.reason },
					...result.fields === void 0 ? {} : { fields: result.fields }
				});
			}
		} catch (error) {
			failed += 1;
			entries.push({
				...identity,
				status: "failed",
				reason: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return {
		saved,
		quarantined,
		skipped,
		failed,
		entries
	};
}
// src/host/annotate.ts
/** A batch is small, but a pathological session could cite dozens of works. */
const MAX_REFS = 12;
const MAX_EXCERPT_CHARS = 6e3;
const MAX_TOKENS = 1400;
const TIMEOUT_MS = 6e4;
const STOPWORDS = /* @__PURE__ */ new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"into",
	"is",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with"
]);
function normalizeWhitespace(value) {
	return value.replace(/\s+/gu, " ").trim();
}
function tokensOf(title) {
	return normalizeWhitespace(stripMarkup(title)).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/u).filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}
function familyOf(ref) {
	const first = ref.authors[0];
	if (first === void 0) return "";
	return (first.family ?? first.literal ?? "").split(/\s+/u)[0]?.toLowerCase() ?? "";
}
/**
* The lines that actually mention this work, widened by one line on each side.
*
* A citation line alone says "this work exists"; the sentence after it usually
* says what the conversation used it for, which is the annotation we want.
*/
function groundingFor(ref, lines) {
	const tokens = tokensOf(ref.title);
	const family = familyOf(ref);
	const doi = (ref.identifiers.doi ?? "").toLowerCase();
	let bestIndex = -1;
	let bestScore = 0;
	for (const [index, line] of lines.entries()) {
		const text = line.text.toLowerCase();
		let score = 0;
		let titleHits = 0;
		for (const token of tokens) {
			if (!text.includes(token)) continue;
			score += 1;
			titleHits += 1;
		}
		if (family !== "" && text.includes(family)) score += 3;
		if (ref.year !== void 0 && text.includes(String(ref.year))) score += 1;
		if (doi !== "" && text.includes(doi)) score += 6;
		if (titleHits === 0) continue;
		if (score > bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	}
	if (bestIndex < 0 || bestScore < 2) return void 0;
	const first = Math.max(0, bestIndex - 1);
	const last = Math.min(lines.length - 1, bestIndex + 1);
	const excerpt = lines.slice(first, last + 1).map((line) => normalizeWhitespace(line.text)).filter((text) => text !== "").join("\n");
	if (excerpt === "") return void 0;
	return excerpt.length <= 900 ? excerpt : `${excerpt.slice(0, 900)}…`;
}
function promptFor(refs) {
	return [
		"Annotate the references below for one citation manager. Use only the excerpts given.",
		"",
		refs.map(({ ref, excerpt }, index) => {
			const authors = ref.authors.map((author) => author.literal ?? [author.family, author.given].filter(Boolean).join(", ")).filter((name) => name !== "");
			const head = {
				index: index + 1,
				title: stripMarkup(ref.title),
				authors,
				...ref.year === void 0 ? {} : { year: ref.year },
				...ref.containerTitle === void 0 ? {} : { container: stripMarkup(ref.containerTitle) },
				...ref.identifiers.doi === void 0 ? {} : { doi: ref.identifiers.doi }
			};
			return `Reference ${String(index + 1)}:\n${JSON.stringify(head)}\nConversation excerpt:\n${excerpt}`;
		}).join("\n\n"),
		"",
		"Reply with a JSON array and nothing else. One object per reference:",
		"{\"index\": 1, \"summary\": \"…\", \"relevance\": \"…\", \"evidence\": \"…\", \"caveats\": \"…\"}",
		"- summary: what the work is or says, one sentence, in the language of the excerpt.",
		"- relevance: why this conversation cites or relies on it, one sentence.",
		"- evidence: the exact sentence from that reference's excerpt that cites or relies on it, copied verbatim. Use \"\" when the excerpt does not say.",
		"- caveats: a limit or uncertainty, one sentence. Use \"\" when there is none.",
		"Never invent DOIs, years, page numbers, or quotes.",
		"When the excerpt does not support a field, answer \"\" for that field. Never describe the excerpt, the context, or what is missing: no \"the excerpt does not mention\", no \"no citation sentence is available\", no \"cannot be determined\". An empty field is the correct answer; a sentence about absence is not.",
		"Empty strings are expected answers, not placeholders."
	].join("\n");
}
/** Model text → array of annotations. Tolerates fences and surrounding prose. */
function parseAnnotations(text) {
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start < 0 || end <= start) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch {
		return;
	}
	if (!Array.isArray(parsed)) return void 0;
	const out = [];
	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;
		const record = item;
		const index = typeof record["index"] === "number" ? record["index"] : NaN;
		if (!Number.isInteger(index) || index < 1) continue;
		const text_ = (key) => {
			const value = record[key];
			if (typeof value !== "string") return "";
			return usefulAnnotationText(normalizeWhitespace(stripMarkup(value)));
		};
		out.push({
			index,
			summary: text_("summary").slice(0, 600),
			relevance: text_("relevance").slice(0, 400),
			evidence: text_("evidence").slice(0, 600),
			caveats: text_("caveats").slice(0, 400)
		});
	}
	return out.length === 0 ? void 0 : out;
}
async function collectCompletion(deps, route, prompt) {
	const llm = deps.llm;
	if (llm === void 0) throw new Error("no model service");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const forward = () => controller.abort();
	deps.signal?.addEventListener("abort", forward, { once: true });
	try {
		let text = "";
		let failure = "";
		const stream = llm.stream({
			provider: route.provider,
			model: route.model,
			messages: [{
				role: "user",
				content: [{
					type: "text",
					text: prompt
				}]
			}],
			system: "You annotate bibliographic references. You answer with a JSON array only, using only the text you were given.",
			temperature: .2,
			maxTokens: MAX_TOKENS,
			signal: controller.signal
		});
		for await (const chunk of stream) {
			if (typeof chunk !== "object" || chunk === null) continue;
			const record = chunk;
			if (record["type"] === "text-delta" && typeof record["text"] === "string") text += record["text"];
			if (record["type"] === "finish") {
				const reason = record["reason"];
				if (reason?.kind === "error" || reason?.kind === "aborted") failure = reason.failure?.message ?? reason.kind;
				break;
			}
		}
		if (failure !== "") throw new Error(failure);
		return text;
	} finally {
		clearTimeout(timer);
		deps.signal?.removeEventListener("abort", forward);
	}
}
function mergeAnnotation(previous, next, now) {
	const keep = previous?.source === "user";
	const pick = (field) => {
		const old = usefulAnnotationText(previous?.[field]);
		if (keep && old !== "") return old;
		const fresh = usefulAnnotationText(next[field]);
		if (fresh !== "") return fresh;
		return old === "" ? void 0 : old;
	};
	const merged = {
		...pick("summary") === void 0 ? {} : { summary: pick("summary") },
		...pick("relevance") === void 0 ? {} : { relevance: pick("relevance") },
		...pick("evidence") === void 0 ? {} : { evidence: pick("evidence") },
		...pick("caveats") === void 0 ? {} : { caveats: pick("caveats") }
	};
	if (Object.keys(merged).length === 0) return void 0;
	return {
		...merged,
		source: keep ? "hybrid" : "model",
		status: "complete",
		updatedAt: now
	};
}
/**
* Annotate stored references from transcript grounding.
*
* Returns counts instead of throwing: capture must succeed even when the model
* is unavailable, because the bibliography is the durable part and the
* annotation is the enrichment.
*/
async function annotateReferences(refs, deps) {
	const considered = refs.length;
	if (considered === 0) return {
		annotated: 0,
		considered: 0,
		model: "",
		reason: "nothing to annotate",
		ids: []
	};
	if (deps.llm === void 0) return {
		annotated: 0,
		considered,
		model: "",
		reason: "this host exposes no model service",
		ids: []
	};
	const route = deps.selection?.();
	if (route === void 0 || route.provider === "" || route.model === "") return {
		annotated: 0,
		considered,
		model: "",
		reason: "no default model is selected in this profile",
		ids: []
	};
	const lines = deps.lines ?? [];
	const grounded = [];
	let budget = MAX_EXCERPT_CHARS;
	for (const ref of refs) {
		if (grounded.length >= MAX_REFS) break;
		const excerpt = groundingFor(ref, lines);
		if (excerpt === void 0) continue;
		if (excerpt.length > budget) continue;
		budget -= excerpt.length;
		grounded.push({
			ref,
			excerpt
		});
	}
	if (grounded.length === 0) return {
		annotated: 0,
		considered,
		model: `${route.provider}/${route.model}`,
		reason: "the conversation excerpt for these entries is not in this capture, so there is nothing to ground an annotation in",
		ids: []
	};
	let reply;
	try {
		reply = await collectCompletion(deps, route, promptFor(grounded));
	} catch (error) {
		return {
			annotated: 0,
			considered,
			model: `${route.provider}/${route.model}`,
			reason: `the model call failed (${error instanceof Error ? error.message : String(error)})`,
			ids: []
		};
	}
	const parsed = parseAnnotations(reply);
	if (parsed === void 0) return {
		annotated: 0,
		considered,
		model: `${route.provider}/${route.model}`,
		reason: "the model did not return a JSON array of annotations",
		ids: []
	};
	return withStoreLock(storePaths(deps.workspace).dir, async () => {
		const now = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
		const store = await loadStore(deps.workspace, { now });
		const quarantine = await loadQuarantine(deps.workspace, { now });
		const storedAnnotations = /* @__PURE__ */ new Map();
		for (const stored of [...store.state.references, ...quarantine.entries]) storedAnnotations.set(stored.id, stored.annotation);
		const answers = new Map(parsed.map((item) => [item.index, item]));
		/** True when an annotation still says something after meta-commentary is removed. */
		const usable = (annotation) => annotation !== void 0 && [
			annotation.summary,
			annotation.relevance,
			annotation.evidence,
			annotation.caveats
		].some((field) => usefulAnnotationText(field) !== "");
		const wanted = /* @__PURE__ */ new Map();
		const drop = /* @__PURE__ */ new Set();
		grounded.forEach(({ ref, excerpt }, index) => {
			const previous = storedAnnotations.get(ref.id);
			const stale = previous !== void 0 && !usable(previous);
			const answer = answers.get(index + 1);
			if (answer === void 0) {
				if (stale) drop.add(ref.id);
				return;
			}
			const haystack = normalizeWhitespace(excerpt);
			const quoted = answer.evidence;
			const evidence = quoted.length >= 12 && haystack.toLowerCase().includes(quoted.toLowerCase()) ? quoted : "";
			if (answer.summary === "" && answer.relevance === "" && evidence === "" && answer.caveats === "") {
				if (stale) drop.add(ref.id);
				return;
			}
			wanted.set(ref.id, {
				summary: answer.summary,
				relevance: answer.relevance,
				evidence,
				caveats: answer.caveats
			});
		});
		if (wanted.size === 0 && drop.size === 0) return {
			annotated: 0,
			considered,
			model: `${route.provider}/${route.model}`,
			reason: "the model returned no usable annotation for these entries",
			ids: []
		};
		const touched = [];
		const annotatedIds = [];
		const apply = (list) => list.map((ref) => {
			const next = wanted.get(ref.id);
			const removeThis = drop.has(ref.id);
			if (next === void 0 && !removeThis) return ref;
			touched.push(ref.id);
			if (next === void 0) {
				const rest = { ...ref };
				delete rest.annotation;
				return {
					...rest,
					updatedAt: now
				};
			}
			const annotation = mergeAnnotation(ref.annotation, next, now);
			if (annotation === void 0) {
				const rest = { ...ref };
				delete rest.annotation;
				return {
					...rest,
					updatedAt: now
				};
			}
			annotatedIds.push(ref.id);
			return {
				...ref,
				annotation,
				updatedAt: now
			};
		});
		const references = apply(store.state.references);
		const entries = apply(quarantine.entries);
		if (touched.length === 0) return {
			annotated: 0,
			considered,
			model: `${route.provider}/${route.model}`,
			reason: "the annotated entries are no longer in the library",
			ids: []
		};
		if (references !== store.state.references) await writeStore(deps.workspace, {
			...store.state,
			updatedAt: now,
			references
		});
		if (entries !== quarantine.entries) await writeQuarantine(deps.workspace, {
			...quarantine,
			updatedAt: now,
			entries
		});
		return {
			annotated: annotatedIds.length,
			considered,
			model: `${route.provider}/${route.model}`,
			...annotatedIds.length === 0 ? { reason: "the stored annotations only described the missing evidence, so they were removed" } : {},
			ids: annotatedIds
		};
	});
}
/**
* Annotate what a capture just stored, and mark the batch entries that gained
* an annotation so the panel can show it without a second read.
*/
async function annotateCaptured(entries, deps) {
	const ids = entries.filter((entry) => entry.id !== void 0 && (entry.status === "saved" || entry.status === "quarantined")).map((entry) => entry.id);
	if (ids.length === 0) return {
		entries: [...entries],
		outcome: {
			annotated: 0,
			considered: 0,
			model: "",
			reason: "nothing was stored",
			ids: []
		}
	};
	const now = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
	const store = await loadStore(deps.workspace, { now });
	const quarantine = await loadQuarantine(deps.workspace, { now });
	const pool = /* @__PURE__ */ new Map();
	for (const ref of [...store.state.references, ...quarantine.entries]) pool.set(ref.id, ref);
	const outcome = await annotateReferences(ids.map((id) => pool.get(id)).filter((ref) => ref !== void 0), deps);
	const annotated = new Set(outcome.ids);
	return {
		entries: entries.map((entry) => entry.id !== void 0 && annotated.has(entry.id) ? {
			...entry,
			annotated: true
		} : entry),
		outcome
	};
}
const MESSAGE_TYPES = {
	"user/message": "user",
	"assistant/message": "assistant",
	"tool/result": "tool"
};
function isRecord$1(value) {
	return typeof value === "object" && value !== null;
}
/** Concatenate text blocks; thinking, images and tool inputs are ignored. */
function blocksText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (!isRecord$1(block)) continue;
		if (block["type"] !== "text") continue;
		const text = block["text"];
		if (typeof text === "string" && text !== "") parts.push(text);
	}
	return parts.join("\n");
}
/**
* Text of one message-shaped event.
*
* The persisted log uses two shapes and both are in the wild:
*
* - `user/message` carries the blocks directly under `data.content`
* - `assistant/message` and `tool/result` carry a whole message under
*   `data.message`, so their blocks live at `data.message.content`
*
* Reading only the flat shape silently dropped every assistant reply — the one
* place citations usually appear — so both are tried here.
*/
function textOfEvent(event) {
	if (MESSAGE_TYPES[event.type] === void 0 || !isRecord$1(event.data)) return "";
	const data = event.data;
	const direct = blocksText(data["content"]);
	if (direct !== "") return direct;
	const message = data["message"];
	if (isRecord$1(message)) {
		const nested = blocksText(message["content"]);
		if (nested !== "") return nested;
		const output = message["output"];
		if (typeof output === "string") return output;
	}
	return "";
}
/** Collect segments, keeping only non-empty text in the requested window. */
function segmentsFrom(events, startSeq, includeTools = false) {
	const segments = [];
	for (const event of events) {
		if (event.seq < startSeq) continue;
		const role = MESSAGE_TYPES[event.type];
		if (role === void 0 || role === "tool" && !includeTools) continue;
		const text = textOfEvent(event);
		if (text.trim() === "") continue;
		segments.push({
			seq: event.seq,
			role,
			text
		});
	}
	return segments;
}
/** Keep the newest content that fits the budget, dropping older segments whole. */
function applyBudget(segments, maxChars) {
	let total = 0;
	let cut = segments.length;
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index];
		if (segment === void 0) break;
		const cost = segment.text.length;
		if (total + cost > maxChars) {
			cut = index + 1;
			break;
		}
		total += cost;
		cut = index;
	}
	return {
		segments: segments.slice(cut),
		truncated: cut > 0,
		chars: total
	};
}
/** Seqs of `turn/start` events, ascending. */
function turnStartsOf(records) {
	return records.filter((record) => record.type === "turn/start").map((record) => record.seq);
}
/**
* Message segments from the live session surface.
*
* The persisted event log can be segmented, so a long conversation's older
* messages may not be readable through `sessionQuery`. The surface is the
* in-process view of everything the transcript shows, which is exactly what
* "capture what we discussed" means — it is the fallback text source.
*/
function surfaceSegments(session, startSeq, includeTools = false) {
	if (typeof session.eventAt !== "function") return [];
	const events = [];
	for (const seq of session.surface.nodes) {
		if (seq < startSeq) continue;
		const event = session.eventAt(seq);
		if (event !== void 0) events.push(event);
	}
	return segmentsFrom(events, startSeq, includeTools);
}
/**
* Read one scope of a conversation.
*
* `query` is the preferred seam. When it is absent and `allowLegacyRead` is
* true, the deprecated `session.eventAt` path is used and `readMode` reports it;
* with neither, the result is empty and `readMode` is `'none'` — the caller is
* expected to say so instead of pretending nothing was found.
*/
async function readTranscript(options) {
	const maxChars = options.maxChars ?? 2e5;
	const empty = (resolution, readMode) => ({
		segments: [],
		readMode,
		resolution,
		truncated: false,
		chars: 0
	});
	const readViaLog = async () => {
		if (options.query === void 0) return void 0;
		try {
			return await readLogWindow(options.query);
		} catch (error) {
			if (options.session === void 0) throw error;
			return;
		}
	};
	const readLogWindow = async (query) => {
		const records = await query.listEvents(options.sessionId);
		const lastSeq = records.at(-1)?.seq ?? -1;
		if (lastSeq < 0) return empty(resolveScope([], -1, options.scope), "sessionQuery");
		const fromLog = turnStartsOf(records);
		const fromProjection = options.turnStarts?.filter((seq) => seq <= lastSeq);
		const resolution = resolveScope(fromProjection !== void 0 && fromProjection.length > 0 ? fromProjection : fromLog, lastSeq, options.scope);
		const live = options.session === void 0 ? [] : surfaceSegments(options.session, resolution.startSeq, options.includeTools ?? false);
		if (live.length > 0) {
			const budgetedLive = applyBudget(live, maxChars);
			return {
				segments: budgetedLive.segments,
				readMode: "session-surface",
				resolution,
				truncated: budgetedLive.truncated,
				chars: budgetedLive.chars
			};
		}
		const inWindow = records.filter((record) => record.seq >= resolution.startSeq).length;
		if (inWindow === 0) return empty(resolution, "sessionQuery");
		const collected = [];
		const seen = /* @__PURE__ */ new Set();
		let anchor = lastSeq;
		for (let page = 0; page < 4; page += 1) {
			const remaining = inWindow - collected.length;
			if (remaining <= 0) break;
			const want = Math.min(remaining, 50);
			const window = await query.readEvent({
				sessionId: options.sessionId,
				seq: anchor,
				before: Math.max(0, want - 1)
			});
			if (window.events.length === 0) break;
			let added = 0;
			for (const event of window.events) {
				if (seen.has(event.seq)) continue;
				seen.add(event.seq);
				collected.push(event);
				added += 1;
			}
			collected.sort((left, right) => left.seq - right.seq);
			const earliest = window.events[0]?.seq;
			if (earliest === void 0 || earliest <= resolution.startSeq) break;
			if (earliest === anchor) break;
			anchor = earliest;
			if (added === 0) break;
		}
		const capped = collected.length < inWindow;
		const budgeted = applyBudget(segmentsFrom(collected, resolution.startSeq, options.includeTools ?? false), maxChars);
		return {
			segments: budgeted.segments,
			readMode: "sessionQuery",
			resolution,
			truncated: capped || budgeted.truncated,
			chars: budgeted.chars
		};
	};
	const logged = await readViaLog();
	if (logged !== void 0) return logged;
	const session = options.session;
	if (session === void 0) return empty(resolveScope([], -1, options.scope), "none");
	if (options.allowLegacyRead !== true) {
		const resolution = resolveScope([], session.seq, options.scope);
		const budgeted = applyBudget(surfaceSegments(session, resolution.startSeq, options.includeTools ?? false), maxChars);
		if (budgeted.segments.length === 0) return empty(resolution, "none");
		return {
			segments: budgeted.segments,
			readMode: "session-surface",
			resolution,
			truncated: budgeted.truncated,
			chars: budgeted.chars
		};
	}
	const nodes = session.surface.nodes;
	const events = [];
	for (const seq of nodes) {
		const event = session.eventAt(seq);
		if (event !== void 0) events.push(event);
	}
	const resolution = resolveScope(turnStartsOf(events.map((event) => ({
		seq: event.seq,
		type: event.type
	}))), nodes.at(-1) ?? -1, options.scope);
	const budgeted = applyBudget(segmentsFrom(events, resolution.startSeq, options.includeTools ?? false), maxChars);
	return {
		segments: budgeted.segments,
		readMode: "legacy-eventAt",
		resolution,
		truncated: budgeted.truncated,
		chars: budgeted.chars
	};
}
// src/host/refs-command.ts
const REFS_USAGE = [
	"usage:",
	"  /refs                                  show capture readiness",
	"  /refs capture [--scope=turn|lastN|all] [--turns=N] [--save] [--dry-run] [--include-tools]",
	"  /refs verify --doi=… | --arxiv=… | --title=… [--json]",
	"",
	"scope: turn (default, current turn) · lastN (previous N turns, default 5) · all",
	"--save verifies each candidate and stores the ones that pass; the rest go to refs/quarantine.json."
].join("\n");
function parseRefsCommand(raw) {
	const tokens = raw.split(/\s+/u).filter((token) => token !== "");
	const sub = tokens.shift() ?? "status";
	if (sub !== "status" && sub !== "capture") return { error: `unknown subcommand "${sub}"\n${REFS_USAGE}` };
	let scopeArg = "";
	let turnsArg = "";
	let save = false;
	let dryRun = false;
	let includeTools = false;
	for (const token of tokens) {
		if (token === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (token === "--save") {
			save = true;
			continue;
		}
		if (token === "--include-tools") {
			includeTools = true;
			continue;
		}
		const match = /^--(scope|turns)=(.*)$/u.exec(token);
		if (match === null) return { error: `unknown option "${token}"\n${REFS_USAGE}` };
		if (match[1] === "scope") scopeArg = match[2] ?? "";
		else turnsArg = match[2] ?? "";
	}
	return {
		sub,
		scopeArg,
		turnsArg,
		save,
		dryRun,
		includeTools
	};
}
/**
* Read the requested scope and extract candidates.
*
* One implementation serves the command and the tool so the two entry points can
* never disagree about scope semantics or dedupe.
*/
async function collectCapture(session, scopeArg, turnsArg, query, turnStarts, includeTools = false) {
	const scope = parseScope(scopeArg, turnsArg);
	if ("error" in scope) return { error: scope.error };
	const read = await readTranscript({
		sessionId: session.id,
		scope,
		query,
		session,
		allowLegacyRead: false,
		turnStarts,
		includeTools
	});
	return {
		scope,
		read,
		candidates: extractCandidates(read.segments.map((segment) => ({
			seq: segment.seq,
			text: segment.text,
			role: segment.role
		})), { includeTools })
	};
}
function formatCandidate(candidate, index) {
	const names = candidate.authors.length === 0 ? "(authors unknown)" : candidate.authors.slice(0, 3).join("; ");
	const year = candidate.year === void 0 ? "n.d." : String(candidate.year);
	const ids = [
		candidate.doi === "" ? "" : `doi:${candidate.doi}`,
		candidate.arxivId === "" ? "" : `arXiv:${candidate.arxivId}`,
		candidate.isbn === "" ? "" : `ISBN:${candidate.isbn}`,
		candidate.reportNumber === "" ? "" : `report:${candidate.reportNumber}`,
		candidate.url === "" ? "" : candidate.url
	].filter((part) => part !== "");
	return [
		`${String(index)}. [${candidate.type}] ${candidate.title === "" ? "(title unknown)" : candidate.title}`,
		`   ${names} (${year})${candidate.container === "" ? "" : ` · ${candidate.container}`}`,
		`   ${ids.length === 0 ? "no identifier" : ids.join(" · ")} · confidence ${candidate.confidence.toFixed(2)} · origins ${candidate.origins.join("+")}${candidate.needsModelEnrichment ? " · needs model" : ""}`,
		`   evidence seq ${candidate.evidence.join(",")}`
	];
}
/** Human-readable capture result shared by `/refs capture` and the tool. */
function renderCapture(run, saving = false) {
	const { read } = run;
	const resolution = read.resolution;
	const degraded = resolution.degraded === "" ? "" : resolution.degraded === "no-turn-boundaries" ? " (no turn boundaries in this session — scope widened to the whole conversation)" : ` (requested ${String(resolution.requestedTurns)} turns, session has ${String(resolution.turns)})`;
	const lines = [
		saving ? "dsh-refkeeper capture — candidates queued for verification and saving" : "dsh-refkeeper capture — candidates only, nothing saved yet",
		`scope: ${describeScope(run.scope)}${degraded}`,
		`window: seq ${String(resolution.startSeq)}..${String(resolution.endSeq)}, ${String(resolution.turns)} turn(s), read via ${read.readMode}`,
		`scanned: ${String(read.segments.length)} message(s), ${String(read.chars)} chars${read.truncated ? " (truncated by budget)" : ""}`,
		`candidates: ${String(run.candidates.length)}`
	];
	if (run.candidates.length === 0) lines.push(read.readMode === "none" ? "no read path available: this host exposes neither sessionQuery nor a live session." : "no DOI / arXiv id / ISBN / report number / citation string found in this scope.");
	else for (const [index, candidate] of run.candidates.entries()) lines.push(...formatCandidate(candidate, index + 1));
	if (!saving) lines.push("run `/refs verify --doi=…` on one candidate, or `/refs save` to store it");
	return lines.join("\n");
}
/** Execute one `/refs` line against a session. Pure I/O through `deps.query`. */
async function runRefsCommand(raw, session, deps) {
	const parsed = parseRefsCommand(raw.trim());
	if ("error" in parsed) return {
		kind: "error",
		text: parsed.error
	};
	if (parsed.sub === "status") {
		const records = deps.query === void 0 ? void 0 : await deps.query.listEvents(session.id);
		const turnCount = records === void 0 ? -1 : records.filter((record) => record.type === "turn/start").length;
		return {
			kind: "success",
			text: [
				`dsh-refkeeper · sdk ${deps.sdkVersion}`,
				`session ${session.id}`,
				records === void 0 ? "read seam: sessionQuery unavailable on this host (capture will report readMode=none)" : `read seam: sessionQuery · ${String(records.length)} events · ${String(turnCount)} turn(s)`,
				"storage: refs/refs.json (verified) + refs/quarantine.json (⚠) · verification: /refs verify (Crossref, OpenAlex, arXiv, DataCite)",
				REFS_USAGE
			].join("\n")
		};
	}
	const run = await collectCapture(session, parsed.scopeArg, parsed.turnsArg, deps.query, deps.turnStarts?.(session), parsed.includeTools);
	if ("error" in run) return {
		kind: "error",
		text: `${run.error}\n${REFS_USAGE}`
	};
	const preview = renderCapture(run, parsed.save);
	if (!parsed.save) return {
		kind: "success",
		text: preview
	};
	if (deps.save === void 0) return {
		kind: "error",
		text: "capture --save is unavailable on this host build; restart or update dsh-refkeeper, then retry. No references were saved."
	};
	const transcript = run.read.segments.map((segment) => ({
		seq: segment.seq,
		text: segment.text,
		role: segment.role
	}));
	const summary = await deps.save(run.candidates, { lines: transcript });
	const stored = summary.saved + summary.quarantined;
	const lines = [
		preview,
		`saved: ${String(summary.saved)} · quarantine: ${String(summary.quarantined)} · skipped (no title): ${String(summary.skipped)} · failed: ${String(summary.failed)}`,
		summary.skipped > 0 ? "Candidates without a title cannot be verified: fill them in via 手动添加 or ask the model to complete them." : stored > 0 ? "This capture is now the default export scope: `/refs export` writes just these entries; `/refs export --all` writes the whole library." : "Nothing was stored, so the export scope is unchanged."
	];
	const outcome = summary.annotations;
	if (outcome !== void 0) lines.push(outcome.reason === void 0 ? `annotations: ${String(outcome.annotated)} of ${String(outcome.considered)} annotated by ${outcome.model}` : `annotations: skipped — ${outcome.reason}`);
	if (summary.batch !== void 0) lines.push(encodeBatch(summary.batch));
	return {
		kind: "success",
		text: lines.join("\n")
	};
}
// src/host/verify-command.ts
const VERIFY_USAGE = [
	"usage:",
	"  /refs verify --doi=10.1000/xyz",
	"  /refs verify --arxiv=2301.00001",
	"  /refs verify --title=\"论文标题\" [--year=2024] [--author=Zhang] [--json]",
	"",
	"Routes: DOI→Crossref/DataCite/OpenAlex; arXiv→arXiv; PMID→PubMed; PMCID→PMC",
	"search + PMID crosswalk; ISBN→Open Library; report number→DataCite; title-only→",
	"Crossref/OpenAlex/arXiv (at most three sources concurrently). PMID/PMCID are",
	"available through ref_verify; slash-command flags above remain DOI/arXiv/title.",
	"Checks title / year (±1) / first author; anything short of 3/3 with a real source",
	"goes to the ⚠ region."
].join("\n");
/** Split on whitespace but keep `--title="two words"` as one token. */
function tokenize$1(raw) {
	const out = [];
	let current = "";
	let quoted = false;
	for (const char of raw) {
		if (char === "\"") {
			quoted = !quoted;
			continue;
		}
		if (!quoted && /\s/u.test(char)) {
			if (current !== "") out.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current !== "") out.push(current);
	return out;
}
function parseVerifyArgs(raw) {
	const tokens = tokenize$1(raw);
	const parsed = {
		doi: "",
		arxivId: "",
		title: "",
		year: void 0,
		authors: [],
		json: false
	};
	for (const token of tokens) {
		if (token === "--json") {
			parsed.json = true;
			continue;
		}
		const match = /^--(doi|arxiv|title|year|author)=(.*)$/u.exec(token);
		if (match === null) return { error: `unknown option "${token}"\n${VERIFY_USAGE}` };
		const option = match[1] ?? "";
		const value = match[2] ?? "";
		if (value === "") return { error: `--${option} needs a value\n${VERIFY_USAGE}` };
		if (option === "doi") parsed.doi = value;
		else if (option === "arxiv") parsed.arxivId = value;
		else if (option === "title") parsed.title = value;
		else if (option === "author") parsed.authors.push(value);
		else {
			if (!/^\d{4}$/u.test(value)) return { error: `--year expects a 4-digit year, got "${value}"\n${VERIFY_USAGE}` };
			parsed.year = Number(value);
		}
	}
	if (parsed.doi === "" && parsed.arxivId === "" && parsed.title === "") return { error: `supply --doi, --arxiv or --title\n${VERIFY_USAGE}` };
	return parsed;
}
function mark(pass) {
	return pass ? "✓" : "✗";
}
function condition(label, check) {
	const score = check.score < 0 ? "" : ` (${check.score.toFixed(2)})`;
	return `  ${mark(check.pass)} ${label}: ${check.ours} ↔ ${check.theirs}${score}`;
}
const STATUS_LABEL = {
	verified: "verified — enters the main table",
	warning: "⚠ warning — needs a human look before export",
	quarantined: "⚠ quarantined — no authoritative source confirms this work",
	unverified: "⚠ unverified — the registries could not be reached; retry later"
};
/** Human-readable verdict, shared by the command and the tool renderer. */
function renderVerify(outcome) {
	const { report } = outcome;
	const lines = [
		`dsh-refkeeper verify — ${STATUS_LABEL[report.status]}`,
		`passed ${String(report.passed)}/3 · sources: ${report.sources.length === 0 ? "none" : report.sources.join(", ")}${report.matchedSource === void 0 ? "" : ` · matched ${report.matchedSource}`}`,
		condition("title ", report.title),
		condition("year  ", report.year),
		condition("author", report.firstAuthor)
	];
	if (report.reasons.length > 0) lines.push(`reasons: ${report.reasons.join(", ")}`);
	if (report.partial) lines.push("partial: at least one registry errored or timed out");
	if (outcome.lookup.records.length > 0) {
		lines.push("records:");
		for (const record of outcome.lookup.records.slice(0, 5)) {
			const year = record.year === void 0 ? "n.d." : String(record.year);
			lines.push(`  · ${record.source} · ${year} · ${record.title}`);
		}
	}
	return lines.join("\n");
}
async function runVerifyCommand(raw, deps) {
	const parsed = parseVerifyArgs(raw.trim());
	if ("error" in parsed) return {
		kind: "error",
		text: parsed.error
	};
	const claim = {
		doi: parsed.doi,
		arxivId: parsed.arxivId,
		title: parsed.title,
		year: parsed.year,
		authors: parsed.authors
	};
	const outcome = await deps.verify(claim);
	if (parsed.json) return {
		kind: "success",
		text: JSON.stringify({
			report: outcome.report,
			records: outcome.lookup.records
		}, null, 2)
	};
	return {
		kind: "success",
		text: renderVerify(outcome)
	};
}
// src/core/panel.ts
/**
* Panel channel markers.
*
* A client plugin cannot register its own Remote namespace and a slash command
* only returns text, so the dock panel reads structured state back out of the
* `command/done` transcript: the host appends one marker line and the panel
* decodes it. Keeping the marker and its codec here means both ends agree on a
* single definition.
*/
/** Line prefix for "the default export folder changed" (or was reported). */
const DIR_MARKER = "refkeeper-dir:";
function encodeDir(setting) {
	return `${DIR_MARKER} ${JSON.stringify(setting)}`;
}
// src/host/store-command.ts
const STORE_USAGE = [
	"usage:",
	"  /refs save {\"title\":\"…\",\"doi\":\"…\",\"year\":2024,…}   verify, then store",
	"  /refs save --payload=<base64url(json)>             lossless, any characters",
	"  /refs save --json='{…}'                            same, but the shell-style",
	"                                                    tokenizer eats the quotes",
	"  /refs list [--limit=N] [--quarantine]              inspect the library",
	"  /refs edit --id=<id> --payload=<base64url(json)>   correct one entry's fields",
	"  /refs enrich [--quarantine]                        refill missing fields from registries",
	"  /refs promote [--ids=<payload>] [--manual --reason=<text>]  reverify and move entries",
	"  /refs remove <id|doi|arxiv>... [--quarantine]      delete specific entries",
	"  /refs remove --all --yes [--quarantine]            empty the table",
	"  /refs export [--format=bibtex|ris|both] [--out=path] [--include-quarantine]",
	"  /refs export [--ids=id,id] [--choose-dir] [--all]  panel tick-box selection",
	"  /refs dir [--set=<base64url(path)>|--clear]         default export folder",
	"export defaults to the references captured by the last `/refs capture --save`;",
	"add --all to export the whole library instead. Without --out, files go to the",
	"folder set by `/refs dir --set=…`, else to refs/exports/ in the workspace.",
	"",
	"Only `verified` references enter the main table; everything else lands in",
	"refs/quarantine.json and is excluded from export unless --include-quarantine."
].join("\n");
/**
* Every subcommand `/refs` routes to this module. Exported so the command
* handler in `index.ts` cannot drift from the parser: a subcommand accepted
* here but missing from that routing list reaches `runRefsCommand` and is
* reported as `unknown subcommand`, which is exactly what happened to `dir`.
*/
const STORE_SUBCOMMANDS = [
	"save",
	"export",
	"list",
	"remove",
	"edit",
	"enrich",
	"dir",
	"promote"
];
function isStoreSubcommand(value) {
	return STORE_SUBCOMMANDS.includes(value);
}
function tokenize(raw) {
	const tokens = [];
	let current = "";
	let quote;
	for (const char of raw) {
		if (quote) {
			if (char === quote) quote = void 0;
			else current += char;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/u.test(char)) {
			if (current !== "") {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current !== "") tokens.push(current);
	return tokens;
}
/** Decode the panel's base64url id list; reference ids may carry spaces and quotes. */
function decodeIdsPayload(payload) {
	try {
		const text = Buffer.from(payload, "base64url").toString("utf8");
		const parsed = JSON.parse(text);
		if (!Array.isArray(parsed)) return { error: "--ids expects a JSON array of reference ids" };
		const ids = [];
		for (const item of parsed) {
			if (typeof item !== "string" || item === "") return { error: "--ids expects a JSON array of reference ids" };
			ids.push(item);
		}
		if (ids.length === 0) return { error: "--ids needs at least one reference id" };
		return ids;
	} catch {
		return { error: "--ids payload is not valid base64url-encoded JSON" };
	}
}
/**
* A reason typed by a person contains spaces, so the panel sends it through
* `encodeFlag` like every other free text. The host still accepts a bare value
* for the slash command: anything that is not base64url-encoded JSON stays as
* written.
*/
function decodeReasonPayload(value) {
	if (value === "") return "";
	try {
		const text = Buffer.from(value, "base64url").toString("utf8");
		if (!text.startsWith("\"")) return value;
		const parsed = JSON.parse(text);
		return typeof parsed === "string" ? parsed : value;
	} catch {
		return value;
	}
}
function parseStoreCommand(raw) {
	const trimmed = raw.trim();
	const sub = /^([a-z]+)/u.exec(trimmed)?.[1] ?? "";
	if (!isStoreSubcommand(sub)) return { error: `unknown subcommand "${sub === "" ? "(empty)" : sub}"` };
	const tokens = tokenize(trimmed.slice(sub.length).trim());
	const out = {
		sub,
		payload: "",
		json: "",
		format: "both",
		out: "",
		limit: 10,
		quarantine: false,
		includeQuarantine: false,
		chooseDir: false,
		dirChoose: false,
		dirClear: false,
		dirPath: "",
		targets: [],
		ids: [],
		all: false,
		yes: false,
		manual: false,
		reason: ""
	};
	const targets = [];
	for (const token of tokens) {
		if (token === "--quarantine") {
			out.quarantine = true;
			continue;
		}
		if (token === "--include-quarantine") {
			out.includeQuarantine = true;
			continue;
		}
		if (token === "--choose-dir") {
			out.chooseDir = true;
			continue;
		}
		if (token === "--choose") {
			out.dirChoose = true;
			continue;
		}
		if (token === "--clear") {
			out.dirClear = true;
			continue;
		}
		const dirPath = /^--set=(.*)$/u.exec(token);
		if (dirPath) {
			out.dirPath = dirPath[1] ?? "";
			continue;
		}
		if (token === "--all") {
			out.all = true;
			continue;
		}
		if (token === "--yes") {
			out.yes = true;
			continue;
		}
		if (token === "--manual") {
			out.manual = true;
			continue;
		}
		const reason = /^--reason=(.*)$/u.exec(token);
		if (reason) {
			out.reason = reason[1] ?? "";
			continue;
		}
		const payload = /^--payload=(.*)$/u.exec(token);
		if (payload) {
			out.payload = payload[1] ?? "";
			continue;
		}
		const json = /^--json=(.*)$/u.exec(token);
		if (json) {
			out.json = json[1] ?? "";
			continue;
		}
		const format = /^--format=(bibtex|ris|both)$/u.exec(token);
		if (format) {
			out.format = format[1];
			continue;
		}
		const outPath = /^--out=(.+)$/u.exec(token);
		if (outPath) {
			out.out = outPath[1] ?? "";
			continue;
		}
		const limit = /^--limit=(\d+)$/u.exec(token);
		if (limit) {
			out.limit = Number(limit[1]);
			continue;
		}
		const editId = /^--id=(.+)$/u.exec(token);
		if (editId) {
			out.targets = [editId[1] ?? ""];
			targets.push(editId[1] ?? "");
			continue;
		}
		const ids = /^--ids=(.*)$/u.exec(token);
		if (ids) {
			const decoded = decodeIdsPayload(ids[1] ?? "");
			if (!Array.isArray(decoded)) return decoded;
			out.ids = decoded;
			continue;
		}
		if (token.startsWith("--")) return { error: `unknown option "${token}"` };
		if (sub === "remove") {
			targets.push(token);
			continue;
		}
		if (sub === "save" && out.json === "") {
			out.json = token;
			continue;
		}
		return { error: `unexpected argument "${token}"` };
	}
	out.targets = targets;
	if (sub === "save" && out.payload === "" && out.json === "") return { error: "save needs a JSON payload (--payload=<base64url> or --json=<json>)" };
	if (sub === "export" && out.format === "both" && out.out !== "") return { error: "--out needs a single --format; both formats write two files" };
	if (out.chooseDir && sub !== "export") return { error: "--choose-dir is valid only for export" };
	if (out.chooseDir && out.out !== "") return { error: "--choose-dir cannot be combined with --out" };
	if (out.ids.length > 0 && sub !== "export" && sub !== "edit" && sub !== "promote") return { error: "--ids is valid only for export, edit or promote" };
	if (out.ids.length > 0 && out.all) return { error: "--ids cannot be combined with --all" };
	if ((out.dirChoose || out.dirClear || out.dirPath !== "") && sub !== "dir") return { error: "--choose, --set and --clear are valid only for dir" };
	if (sub === "dir") {
		if ([
			out.dirChoose,
			out.dirClear,
			out.dirPath !== ""
		].filter(Boolean).length > 1) return { error: "dir takes only one of --choose, --set or --clear" };
		if (out.all || out.ids.length > 0 || targets.length > 0 || out.payload !== "" || out.json !== "" || out.out !== "" || out.chooseDir || out.quarantine || out.includeQuarantine || out.yes) return { error: "dir takes only --set, --choose or --clear" };
		return out;
	}
	if (sub === "remove") {
		if (out.all && targets.length > 0) return { error: "--all cannot be combined with explicit ids" };
		if (!out.all && targets.length === 0) return { error: "remove needs at least one id, DOI or arXiv id (or --all --yes)" };
		if (out.all && !out.yes) return { error: "remove --all deletes every entry; add --yes to confirm" };
		return out;
	}
	if (sub === "edit") {
		const chosen = targets.length > 0 ? targets : [...out.ids];
		if (chosen.length !== 1) return { error: "edit needs exactly one reference id (--id=<id> or --ids=<payload>)" };
		if (out.payload === "") return { error: "edit needs --payload=<base64url(json)> with the fields to change" };
		if (out.all || out.quarantine) return { error: "edit takes a single reference; no --all or --quarantine" };
		out.targets = chosen;
		return out;
	}
	if (sub === "enrich") {
		if (out.all || out.ids.length > 0 || targets.length > 0 || out.payload !== "" || out.out !== "" || out.chooseDir) return { error: "enrich takes no arguments besides --quarantine" };
		return out;
	}
	if (sub === "promote") {
		if (out.manual !== (out.reason !== "")) return { error: "promote --manual requires a non-empty --reason=<text>; --reason is valid only with --manual" };
		if (out.all || targets.length > 0 || out.payload !== "" || out.json !== "" || out.out !== "" || out.quarantine || out.includeQuarantine || out.yes) return { error: "promote takes only --ids, --manual and --reason=<text>" };
		return out;
	}
	if (out.manual || out.reason !== "") return { error: "--manual and --reason are valid only for promote" };
	if (out.yes) return { error: "--yes is valid only for remove --all" };
	if (out.all && sub !== "export") return { error: "--all is valid only for export or remove" };
	if (out.limit < 1 || out.limit > 500) return { error: "--limit must be between 1 and 500" };
	return out;
}
function verificationClaimOf(ref) {
	return {
		title: ref.title,
		authors: ref.authors.map((author) => author.family ?? author.literal ?? "").filter((name) => name !== ""),
		year: ref.year,
		doi: ref.identifiers.doi,
		arxivId: ref.identifiers.arxiv,
		isbn: ref.identifiers.isbn,
		reportNumber: ref.identifiers.reportNumber,
		pmid: ref.identifiers.pmid,
		pmcid: ref.identifiers.pmcid
	};
}
function reportReasons(report) {
	return Array.isArray(report.reasons) ? report.reasons.filter((reason) => typeof reason === "string") : [];
}
function verificationOf(ref, report, now) {
	const reasons = reportReasons(report);
	const titleScore = report.title?.score;
	const firstAuthorPass = report.firstAuthor?.pass;
	const sources = Array.isArray(report.sources) ? report.sources : [];
	return {
		status: report.status,
		checkedAt: now,
		...typeof report.passed === "number" ? { passed: report.passed } : {},
		checks: {
			...typeof titleScore === "number" ? { title: titleScore >= 0 ? titleScore : 0 } : {},
			...typeof firstAuthorPass === "boolean" ? { firstAuthor: firstAuthorPass } : {}
		},
		sources,
		reasons,
		...report.partial ? { note: "partial: at least one source errored or timed out" } : {}
	};
}
const REVERIFICATION_REASON_PREFIX = "refkeeper-latest-verification-reasons:";
async function refreshFailedQuarantineVerifications(workspace, failures, now) {
	if (failures.length === 0) return;
	const reportsById = new Map(failures.map(({ reference, report }) => [reference.id, report]));
	await withStoreLock(storePaths(workspace).dir, async () => {
		const quarantine = await loadQuarantine(workspace, { now });
		let changed = false;
		const entries = quarantine.entries.map((reference) => {
			const report = reportsById.get(reference.id);
			if (report === void 0) return reference;
			changed = true;
			const verification = verificationOf(reference, report, now);
			const reasons = reportReasons(report);
			const detail = reasons.length > 0 ? reasons.join("; ") : `status ${report.status}`;
			const note = verification.note === void 0 ? `re-verification failed: ${detail}` : `${verification.note}; re-verification failed: ${detail}`;
			return {
				...reference,
				verification: {
					...verification,
					note
				}
			};
		});
		if (changed) await writeQuarantine(workspace, {
			...quarantine,
			entries
		});
	});
}
async function batchWithLatestVerificationReasons(workspace, failures) {
	if (failures.length === 0) return void 0;
	const batch = await readBatch(workspace);
	if (batch === void 0) return void 0;
	const reasonsById = new Map(failures.map(({ reference, report }) => {
		const reasons = reportReasons(report);
		return [reference.id, reasons.length > 0 ? reasons.join("; ") : `status ${report.status}`];
	}));
	let changed = false;
	const entries = batch.entries.map((entry) => {
		if (entry.id === void 0) return entry;
		const reason = reasonsById.get(entry.id);
		if (reason === void 0) return entry;
		changed = true;
		return {
			...entry,
			reason: `${REVERIFICATION_REASON_PREFIX}${reason}`
		};
	});
	return changed ? encodeBatch({
		...batch,
		entries
	}) : void 0;
}
function insideWorkspace(workspace, target) {
	const root = resolve(workspace);
	const full = resolve(root, target);
	if (full !== root && !full.startsWith(root + sep)) throw new StoreError("invalid-reference", `refusing to write outside the workspace: ${target}`);
	return full;
}
function stamp(now) {
	const date = new Date(now);
	const pad = (value) => String(value).padStart(2, "0");
	return `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}
function buildReference(payload, deps, now) {
	const base = coerceReference(payload, now);
	if (!base) throw new StoreError("invalid-reference", "payload needs at least a non-empty `title`");
	const provenance = {
		...base.provenance,
		trigger: base.provenance.trigger ?? "command",
		capturedAt: base.provenance.capturedAt || now
	};
	return {
		...base,
		id: referenceId(base),
		provenance,
		addedAt: base.addedAt || now,
		updatedAt: now
	};
}
/** Verify then persist one payload. Shared by `/refs save` and `ref_save`. */
async function saveFromPayload(payload, deps) {
	const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	let ref;
	try {
		ref = buildReference(payload, deps, now);
	} catch (error) {
		return {
			kind: "error",
			text: error instanceof Error ? error.message : String(error)
		};
	}
	let report;
	if (deps.verify) report = await deps.verify(ref);
	if ((report?.status ?? (deps.allowManualConfirm ? "manual" : void 0)) === void 0) return {
		kind: "error",
		text: "no verifier available on this host: pass --verify support, or enable manual confirmation (default off)."
	};
	const verification = report !== void 0 ? verificationOf(ref, report, now) : {
		status: "manual",
		checkedAt: now,
		note: "stored without registry verification (manual confirmation)"
	};
	const stored = {
		...ref,
		verification
	};
	const accepted = verification.status === "verified" || verification.status === "manual";
	try {
		if (accepted) {
			const outcome = await saveReference(deps.workspace, stored, { now });
			return {
				kind: "success",
				status: verification.status,
				id: stored.id,
				quarantined: false,
				reference: stored,
				count: outcome.state.references.length,
				text: [
					`${outcome.replaced ? "updated" : "saved"} ${stored.id} → refs/refs.json`,
					`verification: ${verification.status}${verification.passed !== void 0 ? ` ${String(verification.passed)}/3` : ""}`,
					`library: ${String(outcome.state.references.length)} reference(s)`
				].join("\n")
			};
		}
		const next = await saveQuarantined(deps.workspace, stored, { now });
		if (!next.stored) return {
			kind: "success",
			status: verification.status,
			id: stored.id,
			quarantined: false,
			reference: stored,
			reason: "already in the library",
			count: next.state.entries.length,
			text: [
				`already in the library ${stored.id}; nothing added to refs/quarantine.json`,
				`verification: ${verification.status}${verification.passed !== void 0 ? ` ${String(verification.passed)}/3` : ""}`,
				"This work is in refs/refs.json under an equivalent identity, so no ⚠ copy was created."
			].join("\n")
		};
		return {
			kind: "success",
			status: verification.status,
			id: stored.id,
			quarantined: true,
			reference: stored,
			count: next.state.entries.length,
			text: [
				`⚠ quarantined ${stored.id} → refs/quarantine.json`,
				`verification: ${verification.status}${verification.passed !== void 0 ? ` ${String(verification.passed)}/3` : ""}${verification.reasons && verification.reasons.length > 0 ? ` · ${verification.reasons.join(", ")}` : ""}`,
				KEPT_OUT,
				`quarantine: ${String(next.state.entries.length)} entr${next.state.entries.length === 1 ? "y" : "ies"}`
			].join("\n")
		};
	} catch (error) {
		return {
			kind: "error",
			text: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
		};
	}
}
const KEPT_OUT = "Kept out of the main table; it is not exported unless you pass --include-quarantine.";
/** Decode the base64url payload written by the composer panel. */
function decodePayload(encoded) {
	const base64 = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
	const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
	return Buffer.from(padded, "base64").toString("utf8");
}
async function runSave(parsed, deps) {
	let payload;
	try {
		payload = JSON.parse(parsed.payload === "" ? parsed.json : decodePayload(parsed.payload));
	} catch (error) {
		return {
			kind: "error",
			text: `save payload is not JSON: ${error instanceof Error ? error.message : String(error)}`
		};
	}
	return await saveFromPayload(payload, deps);
}
function settingsPath(workspace) {
	return join(storePaths(workspace).dir, "settings.json");
}
async function readSettings(workspace) {
	try {
		const parsed = JSON.parse(await readFile(settingsPath(workspace), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		const dir = parsed.defaultExportDir;
		return typeof dir === "string" && dir !== "" ? { defaultExportDir: dir } : {};
	} catch {
		return {};
	}
}
async function writeSettings(workspace, settings) {
	await mkdir(storePaths(workspace).dir, { recursive: true });
	await writeFileAtomic(settingsPath(workspace), `${JSON.stringify(settings, null, 2)}\n`);
}
async function resolveExportScope(workspace, includeQuarantine, all, now, ids = []) {
	const main = [...(await loadStore(workspace, { now })).state.references];
	const quarantine = await loadQuarantine(workspace, { now });
	const dedupe = (items) => {
		const seen = /* @__PURE__ */ new Set();
		const kept = [];
		let duplicates = 0;
		for (const ref of items) {
			const key = referenceIdentityKey(ref);
			if (seen.has(key)) {
				duplicates += 1;
				continue;
			}
			seen.add(key);
			kept.push(ref);
		}
		return {
			refs: kept,
			duplicates
		};
	};
	if (ids.length > 0) {
		const wanted = new Set(ids);
		const rawPool = [...main, ...quarantine.entries];
		const selectedKeys = new Set(rawPool.filter((ref) => wanted.has(ref.id)).map(referenceIdentityKey));
		const pool = dedupe(rawPool).refs;
		const refs = pool.filter((ref) => selectedKeys.has(referenceIdentityKey(ref)));
		const quarantined = refs.filter((ref) => quarantine.entries.some((entry) => entry.id === ref.id)).length;
		return {
			refs,
			total: pool.length,
			quarantined,
			duplicates: main.length + quarantine.entries.length - pool.length,
			label: "your selection"
		};
	}
	const { refs: uniqueRefs, duplicates } = dedupe(includeQuarantine ? [...main, ...quarantine.entries] : main);
	let refs = uniqueRefs;
	const quarantined = refs.filter((ref) => quarantine.entries.some((entry) => entry.id === ref.id)).length;
	const total = refs.length;
	if (all) return {
		refs,
		total,
		quarantined,
		duplicates,
		label: "whole library"
	};
	const batch = await readBatch(workspace);
	if (batch === void 0) return {
		refs,
		total,
		quarantined,
		duplicates,
		label: "whole library (no capture recorded yet)"
	};
	const selected = new Set(exportableOf(batch, includeQuarantine));
	const picked = refs.filter((ref) => selected.has(ref.id));
	if (picked.length === 0) return {
		refs: [],
		total,
		quarantined,
		duplicates,
		label: "the last capture stored nothing exportable; use --all to export the library"
	};
	return {
		refs: picked,
		total,
		quarantined,
		duplicates,
		label: "the last capture"
	};
}
/**
* Two exports inside the same minute would otherwise write the same
* `refs-<stamp>.bib`, and the sandbox refuses to replace a file it was not
* asked to overwrite. Number the later ones instead of failing.
*/
function freeName(dir, stem, ext, taken) {
	for (let n = 1; n <= 99; n += 1) {
		const path = join(dir, n === 1 ? `${stem}.${ext}` : `${stem}-${String(n)}.${ext}`);
		if (!taken(path)) return path;
	}
	return join(dir, `${stem}-${String(Date.now())}.${ext}`);
}
/**
* The sandbox refuses to replace an existing file unless the caller read it
* first; a same-minute second export trips exactly that error.
*/
function isOverwriteRefusal(error) {
	const message = error instanceof Error ? error.message : String(error);
	return /cannot overwrite existing|already exists|EEXIST/i.test(message);
}
/** Render and write the library. Shared by `/refs export` and `ref_export`. */
async function exportLibrary(options, deps) {
	const parsed = {
		format: options.format,
		out: options.out ?? "",
		includeQuarantine: options.includeQuarantine ?? false
	};
	const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	if (parsed.out === "" && deps.fs !== void 0) {
		const settings = await readSettings(deps.workspace);
		if (settings.defaultExportDir !== void 0) return await exportToChosenDirectory({
			format: options.format,
			includeQuarantine: parsed.includeQuarantine,
			all: options.all ?? false,
			ids: options.ids ?? []
		}, deps, settings.defaultExportDir);
	}
	storePaths(deps.workspace);
	const scope = await resolveExportScope(deps.workspace, parsed.includeQuarantine, options.all ?? false, now, options.ids ?? []);
	const refs = [...scope.refs];
	const quarantined = scope.quarantined;
	if (refs.length === 0) {
		if (scope.label.startsWith("the last capture stored nothing exportable")) return {
			kind: "success",
			text: "nothing from the last capture is still in the library, so there is nothing to export for it; `/refs export --all` writes the whole library."
		};
		return {
			kind: "success",
			text: parsed.includeQuarantine ? "library and quarantine are empty — nothing to export yet." : "library is empty — nothing to export yet. Capture references (panel 捕获文献, or the model's ref_save); ⚠ entries need --include-quarantine."
		};
	}
	const formats = parsed.format === "both" ? ["bibtex", "ris"] : [parsed.format];
	const written = [];
	const stem = `refs-${stamp(now)}`;
	for (const format of formats) {
		const target = parsed.out !== "" ? parsed.out : freeName(join("refs", "exports"), stem, EXPORT_EXTENSIONS[format], (candidate) => existsSync(insideWorkspace(deps.workspace, candidate)));
		const full = insideWorkspace(deps.workspace, target);
		const text = renderExport(format, refs);
		await writeFileAtomic(full, text);
		written.push(`${full} (${String(Buffer.byteLength(text, "utf8"))} B)`);
	}
	return {
		kind: "success",
		text: [
			`exported ${String(refs.length)} of ${String(scope.total)} reference(s) — ${scope.label}${quarantined > 0 ? `, including ${String(quarantined)} quarantined` : ""}`,
			...scope.duplicates > 0 ? [`${String(scope.duplicates)} duplicate(s) skipped`] : [],
			...scope.label === "the last capture" ? ["  (the whole library is `/refs export --all`)"] : [],
			...written.map((line) => `  ${line}`)
		].join("\n")
	};
}
async function exportToChosenDirectory(options, deps, presetDirectory) {
	const picker = deps.directoryPicker;
	const fs = deps.fs;
	if (fs === void 0 || presetDirectory === void 0 && picker === void 0) return {
		kind: "error",
		text: "Choosing an export directory is unavailable on this host (directory picker or sandboxed filesystem service is missing). No files were written."
	};
	const signal = deps.signal ?? new AbortController().signal;
	const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	const scope = await resolveExportScope(deps.workspace, options.includeQuarantine ?? false, options.all ?? false, now, options.ids ?? []);
	const refs = [...scope.refs];
	const quarantined = scope.quarantined;
	if (refs.length === 0) {
		if (scope.label.startsWith("the last capture stored nothing exportable")) return {
			kind: "success",
			text: "nothing from the last capture is still in the library, so there is nothing to export for it; `/refs export --all` writes the whole library."
		};
		return {
			kind: "success",
			text: options.includeQuarantine ? "library and quarantine are empty — nothing to export yet." : "library is empty — nothing to export yet. Save a reference first; ⚠ entries need --include-quarantine."
		};
	}
	let selectedPath;
	if (presetDirectory !== void 0) selectedPath = presetDirectory;
	else {
		try {
			selectedPath = await picker.pick(signal);
		} catch (error) {
			return {
				kind: "error",
				text: `directory picker failed: ${error instanceof Error ? error.message : String(error)}`
			};
		}
		if (selectedPath === null) return {
			kind: "success",
			text: "export cancelled; no files were written."
		};
	}
	const formats = options.format === "both" ? ["bibtex", "ris"] : [options.format];
	const written = [];
	const failures = [];
	try {
		const directoryTarget = await fs.resolve(selectedPath, { signal });
		if ((await fs.stat(directoryTarget, signal))?.type !== "directory") return {
			kind: "error",
			text: "The selected path is not an accessible directory; no files were written."
		};
		const canonicalDirectory = fs.processPath(directoryTarget);
		if (fs.contains !== void 0) {
			const workspaceTarget = await fs.resolve(deps.workspace, { signal });
			if (!fs.contains(workspaceTarget, directoryTarget)) return {
				kind: "error",
				text: [
					"the selected folder is outside this session's workspace, so the workspace-write sandbox refuses to write there. No files were written.",
					`  folder: ${canonicalDirectory}`,
					`  workspace: ${deps.workspace}`,
					"Choose a folder inside the workspace (the default target is `refs/exports/` in it), or reopen the session with a wider file policy."
				].join("\n")
			};
		}
		const sandboxPolicy = {
			mode: "workspace-write",
			workspaceRoot: deps.workspace
		};
		const stem = `refs-${stamp(now)}`;
		for (const format of formats) {
			const extension = EXPORT_EXTENSIONS[format];
			const content = renderExport(format, refs);
			let written_ = "";
			for (let n = 1; n <= 20; n += 1) {
				const candidate = join(canonicalDirectory, n === 1 ? `${stem}.${extension}` : `${stem}-${String(n)}.${extension}`);
				let filePath = candidate;
				try {
					const fileTarget = await fs.resolve(candidate, { signal });
					filePath = fs.processPath(fileTarget);
					await fs.writeText(fileTarget, content, { kind: "createIfAbsent" }, signal, sandboxPolicy);
					written_ = filePath;
					break;
				} catch (error) {
					if (!isOverwriteRefusal(error) || n === 20) {
						failures.push(`${filePath}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
						break;
					}
				}
			}
			if (written_ !== "") written.push(written_);
		}
	} catch (error) {
		return {
			kind: "error",
			text: `export failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. No files were written.`
		};
	}
	const lines = [
		`exported ${String(written.length)} of ${String(formats.length)} file(s) for ${String(refs.length)} of ${String(scope.total)} reference(s) — ${scope.label}${quarantined > 0 ? `, including ${String(quarantined)} quarantined` : ""}`,
		`  into ${fs.processPath(await fs.resolve(selectedPath, { signal }))}`,
		...written.map((path) => `  ${path}`),
		...failures.map((failure) => `  failed: ${failure}`),
		...failures.some((failure) => /denied|sandbox|workspace-write/i.test(failure)) ? [`  hint: the sandbox only writes inside the session workspace (${deps.workspace}); pick a folder inside it.`] : []
	];
	return {
		kind: failures.length === 0 ? "success" : "error",
		text: lines.join("\n")
	};
}
/**
* Clean a typed or pasted folder path.
*
* Finder's "Copy as Pathname" yields quotes, dragging yields a `file://` URL,
* and terminals hand out `~`; all three are folded to one absolute path.
*/
function normalizeDirInput(raw) {
	let value = raw.trim();
	if ((value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'")) && value.length >= 2) value = value.slice(1, -1).trim();
	if (value.startsWith("file://")) try {
		value = decodeURIComponent(new URL(value).pathname);
	} catch {
		value = value.slice(7);
	}
	if (value === "~") value = homedir();
	else if (value.startsWith("~/")) value = join(homedir(), value.slice(2));
	if (value.length > 1) value = value.replace(/[\\/]+$/u, "");
	return value;
}
/** Validate one folder and remember it as the export default. */
async function rememberDirectory(path, fs, deps) {
	const signal = deps.signal ?? new AbortController().signal;
	try {
		const target = await fs.resolve(path, { signal });
		if ((await fs.stat(target, signal))?.type !== "directory") return {
			kind: "error",
			text: [`\`${path}\` is not an accessible directory; nothing changed.`, "Paste an absolute folder path that already exists."].join("\n")
		};
		const canonical = fs.processPath(target);
		if (fs.contains !== void 0) {
			const workspaceTarget = await fs.resolve(deps.workspace, { signal });
			if (!fs.contains(workspaceTarget, target)) return {
				kind: "error",
				text: [
					"that folder is outside this session's workspace, so the workspace-write sandbox cannot write there; nothing changed.",
					`  folder: ${canonical}`,
					`  workspace: ${deps.workspace}`,
					"Paste a folder inside the workspace."
				].join("\n")
			};
		}
		await writeSettings(deps.workspace, { defaultExportDir: canonical });
		return {
			kind: "success",
			text: [
				`default export folder: ${canonical}`,
				"`/refs export` writes here from now on; `/refs dir --clear` goes back to `refs/exports/`.",
				encodeDir({ dir: canonical })
			].join("\n")
		};
	} catch (error) {
		return {
			kind: "error",
			text: `could not use that folder: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Nothing changed.`
		};
	}
}
/** `/refs dir`: read, choose or clear the folder exports default to. */
async function setDefaultDirectory(options, deps) {
	if (options.clear === true) {
		await writeSettings(deps.workspace, {});
		return {
			kind: "success",
			text: ["default export folder cleared; exports go to `refs/exports/` in the session workspace.", encodeDir({ dir: null })].join("\n")
		};
	}
	if (options.choose !== true && options.path === void 0) {
		const dir = (await readSettings(deps.workspace)).defaultExportDir ?? null;
		return {
			kind: "success",
			text: [dir === null ? "no default export folder; exports go to `refs/exports/` in the session workspace." : `default export folder: ${dir}`, encodeDir({ dir })].join("\n")
		};
	}
	const fs = deps.fs;
	if (fs === void 0) return {
		kind: "error",
		text: "Saving a folder needs the sandboxed filesystem service, which this host does not provide. Nothing changed."
	};
	if (options.path !== void 0) {
		const wanted = normalizeDirInput(options.path);
		if (wanted === "") return {
			kind: "error",
			text: "The folder path is empty; nothing changed."
		};
		return await rememberDirectory(wanted, fs, deps);
	}
	const picker = deps.directoryPicker;
	if (picker === void 0) return {
		kind: "error",
		text: "Choosing a folder is unavailable on this host (directory picker service is missing). Nothing changed."
	};
	const signal = deps.signal ?? new AbortController().signal;
	let picked;
	try {
		picked = await picker.pick(signal);
	} catch (error) {
		return {
			kind: "error",
			text: `directory picker failed: ${error instanceof Error ? error.message : String(error)}. Nothing changed.`
		};
	}
	if (picked === null) return {
		kind: "success",
		text: "folder choice cancelled; nothing changed."
	};
	return await rememberDirectory(picked, fs, deps);
}
/** Counts plus the first N entries; shared by `/refs list` and `ref_list`. */
async function listLibrary(options, deps) {
	const parsed = {
		limit: options.limit ?? 10,
		quarantine: options.quarantine ?? false
	};
	const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	const store = (await loadStore(deps.workspace, { now })).state;
	const quarantine = await loadQuarantine(deps.workspace, { now });
	const lines = [`refs/refs.json · ${String(store.references.length)} reference(s) · updated ${store.updatedAt}`, `refs/quarantine.json · ${String(quarantine.entries.length)} entr${quarantine.entries.length === 1 ? "y" : "ies"}`];
	const source = parsed.quarantine ? quarantine.entries : store.references;
	const shown = source.slice(0, parsed.limit);
	if (shown.length > 0) lines.push("");
	for (const ref of shown) {
		const year = ref.year !== void 0 ? String(ref.year) : "n.d.";
		const container = ref.containerTitle ? ` · ${ref.containerTitle}` : "";
		lines.push(`- ${ref.id} | ${ref.type} | ${ref.title} (${year})${container}`);
	}
	if (source.length > shown.length) lines.push(`… ${String(source.length - shown.length)} more (raise --limit to see them)`);
	return {
		kind: "success",
		text: lines.join("\n")
	};
}
function normalizeTarget(value) {
	return value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, "").replace(/^doi:/u, "");
}
function matchesTarget(ref, normalized) {
	if (ref.id.toLowerCase() === normalized) return true;
	const doi = ref.identifiers.doi;
	if (doi !== void 0 && normalizeTarget(doi) === normalized) return true;
	const arxiv = ref.identifiers.arxiv;
	if (arxiv !== void 0 && normalizeTarget(arxiv) === normalized) return true;
	return false;
}
/** Delete entries from the main table or the quarantine.
*
* Matching is by exact id, DOI or arXiv id — never by title — so a typo cannot
* silently delete the wrong reference, and unknown targets are reported back
* instead of being ignored. */
async function removeReferences(options, deps) {
	const quarantine = options.quarantine === true;
	const table = quarantine ? "refs/quarantine.json" : "refs/refs.json";
	const targets = (options.targets ?? []).map(normalizeTarget).filter((target) => target !== "");
	if (options.all !== true && targets.length === 0) return {
		kind: "error",
		text: `remove needs at least one id, DOI or arXiv id (or --all --yes)\n${STORE_USAGE}`
	};
	return withStoreLock(storePaths(deps.workspace).dir, async () => {
		const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
		const before = quarantine ? (await loadQuarantine(deps.workspace, { now })).entries : (await loadStore(deps.workspace, { now })).state.references;
		if (before.length === 0) return {
			kind: "success",
			text: `${table} is empty; nothing to remove`
		};
		const kept = options.all === true ? [] : before.filter((ref) => !targets.some((target) => matchesTarget(ref, target)));
		const missing = options.all === true ? [] : targets.filter((target) => !before.some((ref) => matchesTarget(ref, target)));
		const removed = before.length - kept.length;
		if (removed === 0) return {
			kind: "error",
			text: `nothing matched in ${table}; nothing was changed   (${before.length} entr${before.length === 1 ? "y" : "ies"} kept)\nuse /refs list to copy exact ids`
		};
		const removedIdentities = new Set(before.filter((ref) => options.all === true || targets.some((target) => matchesTarget(ref, target))).map((ref) => referenceIdentityKey(ref)));
		let alsoDropped = 0;
		if (quarantine) await writeQuarantine(deps.workspace, {
			schemaVersion: 1,
			updatedAt: now,
			entries: kept
		});
		else {
			await writeStore(deps.workspace, {
				schemaVersion: 1,
				updatedAt: now,
				references: kept
			});
			const stale = await loadQuarantine(deps.workspace, { now });
			const remaining = stale.entries.filter((ref) => !removedIdentities.has(referenceIdentityKey(ref)));
			alsoDropped = stale.entries.length - remaining.length;
			if (alsoDropped > 0) await writeQuarantine(deps.workspace, {
				schemaVersion: 1,
				updatedAt: now,
				entries: remaining
			});
		}
		return {
			kind: "success",
			text: [
				`removed ${String(removed)} of ${String(before.length)} entr${before.length === 1 ? "y" : "ies"} from ${table}`,
				`remaining: ${String(kept.length)}`,
				...missing.length > 0 ? [`unmatched: ${missing.join(", ")}`] : [],
				...alsoDropped > 0 ? [`also dropped ${String(alsoDropped)} quarantined duplicate(s) of the same work`] : []
			].join("\n")
		};
	});
}
/** Map `"Family, Given"` display strings back onto stored author objects. */
function authorsFromStrings(values) {
	const authors = [];
	values.forEach((value, index) => {
		if (typeof value !== "string") return;
		const trimmed = value.trim();
		if (trimmed === "") return;
		const [family, ...given] = trimmed.split(",");
		const head = (family ?? "").trim();
		const tail = given.join(",").trim();
		authors.push(tail === "" ? {
			literal: head,
			sequence: index
		} : {
			family: head,
			given: tail,
			sequence: index
		});
	});
	return authors;
}
const EDITABLE_TEXT = [
	"containerTitle",
	"volume",
	"issue",
	"pages",
	"publisher",
	"publisherPlace",
	"language",
	"url"
];
/**
* Correct one entry's metadata in place.
*
* Editing is not re-verification: the user is fixing what the registry (or the
* capture) got wrong, so the record keeps its table and its verification status
* and the exporters simply write the corrected fields.
*/
/**
* Apply one patch to one record. Shared by the edit path so a duplicate copy in
* the other table receives exactly the same correction.
*/
function applyPatch(current, patch, now) {
	const changed = [];
	const next = { ...current };
	if (typeof patch["title"] === "string" && patch["title"].trim() !== "") {
		next.title = patch["title"].trim();
		changed.push("title");
	}
	if (typeof patch["type"] === "string" && patch["type"] !== "") {
		next.type = patch["type"];
		changed.push("type");
	}
	if (typeof patch["year"] === "number" && Number.isFinite(patch["year"])) {
		next.year = patch["year"];
		changed.push("year");
	}
	for (const field of EDITABLE_TEXT) if (typeof patch[field] === "string") {
		next[field] = patch[field].trim() === "" ? void 0 : patch[field].trim();
		changed.push(field);
	}
	if (Array.isArray(patch["authors"])) {
		next.authors = authorsFromStrings(patch["authors"]);
		changed.push("authors");
	}
	const identifiers = { ...current.identifiers };
	let identifiersChanged = false;
	let doiOrArxivChanged = false;
	if (typeof patch["doi"] === "string") {
		const doi = patch["doi"].trim();
		identifiers.doi = doi === "" ? void 0 : doi;
		identifiersChanged = true;
		doiOrArxivChanged = true;
	}
	if (typeof patch["arxivId"] === "string") {
		const arxiv = patch["arxivId"].trim();
		identifiers.arxiv = arxiv === "" ? void 0 : arxiv;
		identifiersChanged = true;
		doiOrArxivChanged = true;
	}
	if (typeof patch["pmid"] === "string") {
		const pmid = patch["pmid"].replace(/\s+/gu, "");
		identifiers.pmid = pmid === "" ? void 0 : pmid;
		identifiersChanged = true;
		changed.push("pmid");
	}
	if (typeof patch["pmcid"] === "string") {
		const pmcid = patch["pmcid"].replace(/\s+/gu, "").toUpperCase();
		identifiers.pmcid = pmcid === "" ? void 0 : pmcid;
		identifiersChanged = true;
		changed.push("pmcid");
	}
	if (identifiersChanged) next.identifiers = identifiers;
	if (doiOrArxivChanged) changed.push("doi/arxiv");
	next.updatedAt = now;
	return {
		next: { ...next },
		changed
	};
}
/**
* Correct one entry's metadata in place.
*
* Editing is not re-verification: the user is fixing what the registry (or the
* capture) got wrong, so the record keeps its table and its verification status
* and the exporters simply write the corrected fields.
*
* The same work may still exist in both tables (legacy data, or a capture that
* failed once and succeeded later). The patch is applied to every copy sharing
* the pre-edit identity, so fix/edit cannot leave the two tables disagreeing.
*/
async function editReference(request, deps) {
	return withStoreLock(storePaths(deps.workspace).dir, async () => {
		const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
		const store = await loadStore(deps.workspace, { now });
		const quarantine = await loadQuarantine(deps.workspace, { now });
		const inMain = store.state.references.find((ref) => ref.id === request.id);
		const inQuarantine = quarantine.entries.find((ref) => ref.id === request.id);
		const current = inMain ?? inQuarantine;
		if (current === void 0) return {
			kind: "error",
			text: `no reference with id "${request.id}" in either table`
		};
		const identityBefore = referenceIdentityKey(current);
		const applied = applyPatch(current, request.patch, now);
		if (applied.changed.length === 0) return {
			kind: "error",
			text: "nothing to change: the payload carried no known field"
		};
		const edited = applied.next;
		let synced = 0;
		if (inMain !== void 0) {
			const references = store.state.references.map((ref) => ref.id === edited.id ? edited : ref);
			await writeStore(deps.workspace, {
				...store.state,
				updatedAt: now,
				references
			});
			const dupes = quarantine.entries.filter((ref) => referenceIdentityKey(ref) === identityBefore);
			if (dupes.length > 0) {
				const entries = quarantine.entries.map((ref) => referenceIdentityKey(ref) === identityBefore ? applyPatch(ref, request.patch, now).next : ref);
				await writeQuarantine(deps.workspace, {
					...quarantine,
					updatedAt: now,
					entries
				});
				synced = dupes.length;
			}
		} else {
			const entries = quarantine.entries.map((ref) => ref.id === edited.id ? edited : ref);
			await writeQuarantine(deps.workspace, {
				...quarantine,
				updatedAt: now,
				entries
			});
			const dupes = store.state.references.filter((ref) => referenceIdentityKey(ref) === identityBefore);
			if (dupes.length > 0) {
				const references = store.state.references.map((ref) => referenceIdentityKey(ref) === identityBefore ? applyPatch(ref, request.patch, now).next : ref);
				await writeStore(deps.workspace, {
					...store.state,
					updatedAt: now,
					references
				});
				synced = dupes.length;
			}
		}
		return {
			kind: "success",
			text: [
				`edited ${edited.id} → refs/${inMain === void 0 ? "quarantine.json" : "refs.json"}`,
				`fields: ${applied.changed.join(", ")}`,
				`title: ${edited.title}`,
				...synced > 0 ? [`also updated ${String(synced)} duplicate copy/copies in ${inMain === void 0 ? "refs/refs.json" : "refs/quarantine.json"}`] : []
			].join("\n")
		};
	});
}
/**
* Backfill bibliographic fields on entries that were stored before the
* registries' volume/issue/pages/publisher/language were parsed.
*
* Unlike `/refs edit` this never overwrites what is already there and never
* re-runs verification: it only fills the blanks, so a user's correction wins.
*/
async function enrichReferences(options, deps) {
	const resolve = deps.resolveIdentifiers;
	if (resolve === void 0) return {
		kind: "error",
		text: "enrich needs the registry resolver, which this host build did not provide"
	};
	const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
	const cleanOne = (ref) => {
		const cleaned = [];
		const next = { ...ref };
		for (const field of [
			"title",
			"containerTitle",
			"publisher",
			"publisherPlace"
		]) {
			const value = next[field];
			if (typeof value !== "string") continue;
			const clean = stripMarkup(value);
			if (clean === value) continue;
			next[field] = clean;
			cleaned.push(`${field} (markup)`);
		}
		let authorsChanged = false;
		const authors = ref.authors.map((author) => {
			if (author.literal !== void 0 && author.literal !== "") {
				const literal = stripMarkup(author.literal);
				if (literal === author.literal) return author;
				authorsChanged = true;
				return {
					...author,
					literal
				};
			}
			const family = author.family === void 0 ? void 0 : stripMarkup(author.family);
			const given = author.given === void 0 ? void 0 : stripMarkup(author.given);
			if (family === author.family && given === author.given) return author;
			authorsChanged = true;
			return {
				...author,
				...family === void 0 ? {} : { family },
				...given === void 0 ? {} : { given }
			};
		});
		if (authorsChanged) {
			next.authors = authors;
			cleaned.push("authors (markup)");
		}
		if (cleaned.length === 0) return void 0;
		next.updatedAt = now;
		return {
			next: { ...next },
			cleaned
		};
	};
	const store = await loadStore(deps.workspace, { now });
	const quarantine = options.quarantine === true ? await loadQuarantine(deps.workspace, { now }) : void 0;
	const enrichOne = async (ref) => {
		const doi = ref.identifiers.doi ?? "";
		const arxiv = ref.identifiers.arxiv ?? "";
		const reportNumber = ref.identifiers.reportNumber ?? "";
		const isbn = ref.identifiers.isbn ?? "";
		const url = ref.url ?? "";
		if (doi === "" && arxiv === "" && reportNumber === "") return void 0;
		let record;
		try {
			record = await resolve(doi, arxiv, "", "", reportNumber, isbn, url);
		} catch {
			record = void 0;
		}
		if (record === void 0) return void 0;
		const filled = [];
		const next = { ...ref };
		const fromRegistry = {
			containerTitle: record.container,
			volume: record.volume,
			issue: record.issue,
			pages: record.pages,
			publisher: record.publisher,
			language: record.language,
			url: record.url
		};
		for (const field of EDITABLE_TEXT) {
			if (next[field] !== void 0 && next[field] !== "") continue;
			const value = fromRegistry[field];
			if (typeof value === "string" && value.trim() !== "") {
				next[field] = value.trim();
				filled.push(field);
			}
		}
		if ((next.year === void 0 || next.year === 0) && typeof record.year === "number") {
			next.year = record.year;
			filled.push("year");
		}
		if (next.authors.length === 0 && Array.isArray(record.authors) && record.authors.length > 0) {
			next.authors = record.authors.map((author, index) => ({
				family: author.family,
				given: author.given,
				literal: author.literal,
				sequence: index
			}));
			filled.push("authors");
		}
		if (filled.length === 0) return void 0;
		next.updatedAt = now;
		return {
			next: { ...next },
			filled
		};
	};
	const mainIds = new Set(store.state.references.map((ref) => ref.id));
	const quarantineIds = new Set(quarantine?.entries.map((ref) => ref.id) ?? []);
	const looked = store.state.references.length + (quarantine?.entries.length ?? 0);
	const mainCandidates = /* @__PURE__ */ new Map();
	const quarantineCandidates = /* @__PURE__ */ new Map();
	const gatherCandidates = async (refs, candidates) => {
		for (const ref of refs) {
			const base = cleanOne(ref)?.next ?? ref;
			const outcome = await enrichOne(base);
			if (outcome === void 0) continue;
			candidates.set(ref.id, {
				doi: ref.identifiers.doi ?? "",
				arxiv: ref.identifiers.arxiv ?? "",
				next: outcome.next,
				filled: outcome.filled
			});
		}
	};
	await gatherCandidates(store.state.references, mainCandidates);
	if (quarantine !== void 0) await gatherCandidates(quarantine.entries, quarantineCandidates);
	return withStoreLock(storePaths(deps.workspace).dir, async () => {
		const committedAt = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
		const latestStore = await loadStore(deps.workspace, { now: committedAt });
		const latestQuarantine = options.quarantine === true ? await loadQuarantine(deps.workspace, { now: committedAt }) : void 0;
		const report = [];
		const applyCandidates = (refs, initialIds, candidates, suffix = "") => {
			let changed = 0;
			return {
				references: refs.map((ref) => {
					if (!initialIds.has(ref.id)) return ref;
					const cleaned = cleanOne(ref);
					const changedFields = [...cleaned?.cleaned ?? []];
					let next = cleaned?.next ?? ref;
					const candidate = candidates.get(ref.id);
					if (candidate !== void 0 && candidate.doi === (ref.identifiers.doi ?? "") && candidate.arxiv === (ref.identifiers.arxiv ?? "")) {
						const filled = new Set(candidate.filled);
						const mutable = { ...next };
						for (const field of EDITABLE_TEXT) {
							if (!filled.has(field) || mutable[field] !== void 0 && mutable[field] !== "") continue;
							const value = candidate.next[field];
							if (typeof value === "string" && value.trim() !== "") {
								mutable[field] = value.trim();
								changedFields.push(field);
							}
						}
						if (filled.has("year") && (mutable.year === void 0 || mutable.year === 0) && candidate.next.year !== void 0) {
							mutable.year = candidate.next.year;
							changedFields.push("year");
						}
						if (filled.has("authors") && mutable.authors.length === 0 && candidate.next.authors.length > 0) {
							mutable.authors = candidate.next.authors;
							changedFields.push("authors");
						}
						next = mutable;
					}
					if (changedFields.length === 0) return ref;
					next = {
						...next,
						updatedAt: committedAt
					};
					changed += 1;
					report.push(`${ref.id} → ${changedFields.join(", ")}${suffix}`);
					return next;
				}),
				changed
			};
		};
		const main = applyCandidates(latestStore.state.references, mainIds, mainCandidates);
		const quarantined = latestQuarantine === void 0 ? void 0 : applyCandidates(latestQuarantine.entries, quarantineIds, quarantineCandidates, " (quarantine)");
		if (main.changed === 0 && (quarantined?.changed ?? 0) === 0) return {
			kind: "success",
			text: `enriched 0 of ${looked} reference(s): no missing fields, no Markdown to clean, or no registry matched`
		};
		if (main.changed > 0) await writeStore(deps.workspace, {
			...latestStore.state,
			updatedAt: committedAt,
			references: main.references
		});
		if (quarantined !== void 0 && quarantined.changed > 0 && latestQuarantine !== void 0) await writeQuarantine(deps.workspace, {
			...latestQuarantine,
			updatedAt: committedAt,
			entries: quarantined.references
		});
		const shown = report.slice(0, 10);
		return {
			kind: "success",
			text: [
				`enriched ${report.length} of ${looked} reference(s)`,
				...shown.map((line) => `  ${line}`),
				...report.length > shown.length ? [`  …and ${report.length - shown.length} more`] : []
			].join("\n")
		};
	});
}
/** Execute one `/refs save|remove|export|list|edit` line. */
async function runStoreCommand(raw, deps) {
	const parsed = parseStoreCommand(raw);
	if ("error" in parsed) return {
		kind: "error",
		text: `${parsed.error}\n${STORE_USAGE}`
	};
	try {
		if (parsed.sub === "save") return await runSave(parsed, deps);
		if (parsed.sub === "edit") {
			let patch;
			try {
				const decoded = JSON.parse(decodePayload(parsed.payload));
				if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) return {
					kind: "error",
					text: "edit payload must be a JSON object of the fields to change"
				};
				patch = decoded;
			} catch {
				return {
					kind: "error",
					text: "edit payload is not valid base64url-encoded JSON"
				};
			}
			return await editReference({
				id: parsed.targets[0] ?? "",
				patch
			}, deps);
		}
		if (parsed.sub === "enrich") return await enrichReferences({ quarantine: parsed.quarantine }, deps);
		if (parsed.sub === "promote") {
			const now = deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString();
			const quarantine = await loadQuarantine(deps.workspace, { now });
			if (parsed.ids.length > 0 && quarantine.entries.every((ref) => !parsed.ids.includes(ref.id))) {
				const library = await loadStore(deps.workspace, { now });
				const inLibrary = parsed.ids.filter((id) => library.state.references.some((ref) => ref.id === id));
				if (inLibrary.length > 0) return {
					kind: "success",
					text: [`already in the library: ${inLibrary.join(", ")}`, "It is in refs/refs.json, so there is nothing to re-verify. The ⚠ in the list is the status this entry had when it was captured; the next capture records it as saved."].join("\n")
				};
			}
			if (!parsed.manual && deps.verify === void 0) return {
				kind: "error",
				text: "promote requires the live verifier; no entries were changed"
			};
			const requested = parsed.ids.length > 0 ? new Set(parsed.ids) : void 0;
			const pool = requested === void 0 ? quarantine.entries : quarantine.entries.filter((ref) => requested.has(ref.id));
			if (requested !== void 0 && pool.length === 0) return {
				kind: "error",
				text: "none of those ids are in quarantine; no entries were changed"
			};
			const reason = decodeReasonPayload(parsed.reason);
			const candidates = [];
			const rejected = [];
			const failedVerifications = [];
			for (const ref of pool) {
				if (parsed.manual) {
					const previous = (ref.verification.reasons ?? []).join(", ") || "quarantined without a stated reason";
					const note = reason === "" ? `manual promotion; originally: ${previous}` : `${reason}; originally: ${previous}`;
					candidates.push({
						...ref,
						verification: {
							status: "manual",
							checkedAt: now,
							note
						}
					});
					continue;
				}
				const report = await deps.verify?.(ref);
				if (report?.status === "verified") candidates.push({
					...ref,
					verification: verificationOf(ref, report, now)
				});
				else {
					rejected.push(ref.id);
					if (report !== void 0) failedVerifications.push({
						reference: ref,
						report
					});
				}
			}
			await refreshFailedQuarantineVerifications(deps.workspace, failedVerifications, now);
			const result = await promoteQuarantined(deps.workspace, candidates, { now });
			const scope = requested === void 0 ? `${String(quarantine.entries.length)} quarantined reference(s)` : `${String(pool.length)} selected of ${String(quarantine.entries.length)} quarantined`;
			const lines = [`promoted ${String(result.promoted.length)} of ${scope}`];
			if (result.replaced > 0) lines.push(`${String(result.replaced)} replaced an existing entry`);
			if (result.skipped > 0) lines.push(`${String(result.skipped)} no longer in quarantine`);
			if (rejected.length > 0) lines.push(`still quarantined (did not verify): ${rejected.join(", ")}`);
			const verificationBatch = await batchWithLatestVerificationReasons(deps.workspace, failedVerifications);
			if (verificationBatch !== void 0) lines.push(verificationBatch);
			return {
				kind: "success",
				text: lines.join("\n")
			};
		}
		if (parsed.sub === "dir") {
			let path;
			if (parsed.dirPath !== "") {
				const payload = parsed.dirPath.startsWith("--set=") ? parsed.dirPath.slice(6) : parsed.dirPath;
				try {
					const decoded = Buffer.from(payload, "base64url").toString("utf8");
					if (decoded.includes("�")) return {
						kind: "error",
						text: "the folder path did not survive the command line; reload the panel and paste it again. Nothing changed."
					};
					path = decoded.startsWith("\"") ? JSON.parse(decoded) : decoded;
				} catch {
					return {
						kind: "error",
						text: "the folder path is not valid base64url text. Nothing changed."
					};
				}
			}
			return await setDefaultDirectory({
				choose: parsed.dirChoose,
				clear: parsed.dirClear,
				...path === void 0 ? {} : { path }
			}, deps);
		}
		if (parsed.sub === "remove") return await removeReferences({
			targets: parsed.targets,
			all: parsed.all,
			quarantine: parsed.quarantine
		}, deps);
		if (parsed.sub === "export") {
			if (parsed.chooseDir) return await exportToChosenDirectory({
				format: parsed.format,
				includeQuarantine: parsed.includeQuarantine,
				all: parsed.all,
				ids: parsed.ids
			}, deps);
			return await exportLibrary({
				format: parsed.format,
				out: parsed.out,
				includeQuarantine: parsed.includeQuarantine,
				all: parsed.all,
				ids: parsed.ids
			}, deps);
		}
		return await listLibrary({
			limit: parsed.limit,
			quarantine: parsed.quarantine
		}, deps);
	} catch (error) {
		return {
			kind: "error",
			text: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
		};
	}
}
// src/verify/clients.ts
/**
* Registry clients, split into the two halves that can be tested without a
* network: URL construction and payload parsing.
*
* Transport is deliberately absent. M2 wires `fetch` on top of these; keeping
* the parsing pure means a registry changing its JSON shape shows up as a
* failing fixture test instead of a runtime surprise during a capture.
*/
function withMailto(url, options) {
	const mailto = options?.mailto?.trim();
	if (mailto === void 0 || mailto === "") return url;
	return `${url}${url.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(mailto)}`;
}
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function strings(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => typeof entry === "string" && entry.trim() !== "");
}
function yearOf(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && /^\d{4}$/u.test(value)) return Number(value);
}
/** A trimmed non-empty string, or undefined; keeps `BatchFields` free of `''`. */
function textOf(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/** `page: "1-15"`, or OpenAlex's split first/last page pair. */
function pagesOf(first, last) {
	const start = textOf(first);
	if (start === void 0) return void 0;
	const end = textOf(last);
	if (end === void 0 || end === start) return start;
	return `${start}-${end}`;
}
/** `issued: {"date-parts": [[2024, 5]]}` (Crossref) and friends. */
function crossrefYear(issued) {
	if (!isRecord(issued)) return void 0;
	const parts = issued["date-parts"];
	if (!Array.isArray(parts) || parts.length === 0) return void 0;
	const first = parts[0];
	if (!Array.isArray(first) || first.length === 0) return void 0;
	return yearOf(first[0]);
}
function crossrefDoiUrl(doi, options) {
	return withMailto(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, options);
}
function crossrefSearchUrl(query, rows = 5, options) {
	return withMailto(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${String(rows)}&select=DOI,title,author,issued,container-title,type,URL,volume,issue,page,publisher,language`, options);
}
function dataciteQueryUrl(query, options) {
	return withMailto(`https://api.datacite.org/dois?query=${encodeURIComponent(query)}&page[size]=5`, options);
}
/** One item from `message.items[]` or `message` for a single-DOI lookup. */
function parseCrossrefWork(raw) {
	if (!isRecord(raw)) return void 0;
	const work = isRecord(raw["message"]) ? raw["message"] : raw;
	const title = strings(work["title"])[0]?.trim() ?? "";
	const doi = typeof work["DOI"] === "string" ? work["DOI"].trim().toLowerCase() : "";
	if (title === "" && doi === "") return void 0;
	return {
		source: "crossref",
		id: doi,
		title,
		authors: Array.isArray(work["author"]) ? work["author"].flatMap((author) => {
			if (!isRecord(author)) return [];
			const family = typeof author["family"] === "string" ? author["family"] : "";
			const given = typeof author["given"] === "string" ? author["given"] : "";
			const literal = typeof author["name"] === "string" ? author["name"] : "";
			if (literal !== "") return [literal];
			if (family === "") return [];
			return [given === "" ? family : `${family}, ${given}`];
		}) : [],
		year: crossrefYear(work["issued"]),
		container: strings(work["container-title"])[0] ?? "",
		doi,
		type: typeof work["type"] === "string" ? work["type"] : "",
		url: typeof work["URL"] === "string" ? work["URL"] : "",
		...fieldOf("volume", textOf(work["volume"])),
		...fieldOf("issue", textOf(work["issue"])),
		...fieldOf("pages", textOf(work["page"])),
		...fieldOf("publisher", textOf(work["publisher"])),
		...fieldOf("language", textOf(work["language"]))
	};
}
/** Spread helper: omit absent fields so `undefined` never lands in a record. */
function fieldOf(key, value) {
	return value === void 0 ? {} : { [key]: value };
}
function parseCrossrefSearch(raw) {
	if (!isRecord(raw)) return [];
	const message = isRecord(raw["message"]) ? raw["message"] : raw;
	return (Array.isArray(message["items"]) ? message["items"] : []).flatMap((item) => {
		const record = parseCrossrefWork(item);
		return record === void 0 ? [] : [record];
	});
}
function openalexDoiUrl(doi, options) {
	return withMailto(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, options);
}
function openalexSearchUrl(query, perPage = 5, options) {
	return withMailto(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${String(perPage)}`, options);
}
function parseOpenAlexWork(raw) {
	if (!isRecord(raw)) return void 0;
	const title = (typeof raw["title"] === "string" ? raw["title"] : typeof raw["display_name"] === "string" ? raw["display_name"] : "").trim();
	const doi = typeof raw["doi"] === "string" ? raw["doi"].replace(/^https?:\/\/doi\.org\//iu, "").trim().toLowerCase() : "";
	if (title === "" && doi === "") return void 0;
	const authors = Array.isArray(raw["authorships"]) ? raw["authorships"].flatMap((entry) => {
		if (!isRecord(entry) || !isRecord(entry["author"])) return [];
		const name = entry["author"]["display_name"];
		return typeof name === "string" && name !== "" ? [name] : [];
	}) : [];
	const primary = isRecord(raw["primary_location"]) ? raw["primary_location"] : void 0;
	const source = primary !== void 0 && isRecord(primary["source"]) ? primary["source"] : void 0;
	const biblio = isRecord(raw["biblio"]) ? raw["biblio"] : void 0;
	return {
		source: "openalex",
		id: typeof raw["id"] === "string" ? raw["id"].replace(/^https?:\/\/openalex\.org\//iu, "") : doi,
		title,
		authors,
		year: yearOf(raw["publication_year"]),
		container: source !== void 0 && typeof source["display_name"] === "string" ? source["display_name"] : "",
		doi,
		type: typeof raw["type"] === "string" ? raw["type"] : "",
		url: doi === "" ? "" : `https://doi.org/${doi}`,
		...fieldOf("volume", biblio === void 0 ? void 0 : textOf(biblio["volume"])),
		...fieldOf("issue", biblio === void 0 ? void 0 : textOf(biblio["issue"])),
		...fieldOf("pages", biblio === void 0 ? void 0 : pagesOf(biblio["first_page"], biblio["last_page"])),
		...fieldOf("publisher", source === void 0 ? void 0 : textOf(source["publisher"]) ?? textOf(source["host_organization_name"])),
		...fieldOf("language", textOf(raw["language"]))
	};
}
function parseOpenAlexSearch(raw) {
	if (!isRecord(raw)) return [];
	return (Array.isArray(raw["results"]) ? raw["results"] : []).flatMap((entry) => {
		const record = parseOpenAlexWork(entry);
		return record === void 0 ? [] : [record];
	});
}
function arxivSearchUrl(query, maxResults = 5) {
	const scoped = /^[a-z]+:/u.test(query) ? query : `all:${query}`;
	return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(scoped)}&max_results=${String(maxResults)}`;
}
/**
* Exact arXiv lookup.
*
* `search_query=all:<id>` goes through the fuzzy text index and can return the
* wrong paper; `id_list` is the documented exact form.
*/
function arxivIdUrl(arxivId) {
	const bare = arxivId.replace(/^arxiv:/iu, "").replace(/v\d+$/u, "");
	return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(bare)}&max_results=1`;
}
function xmlText(block, tag) {
	const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "u").exec(block);
	if (match === null) return "";
	return (match[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();
}
/**
* Parse the arXiv Atom feed.
*
* Hand-rolled rather than pulling an XML dependency: the feed is a fixed shape,
* and the plugin's whole install footprint is currently zero runtime deps.
*/
function parseArxivFeed(xml) {
	return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gu)].flatMap((match) => {
		const block = match[1] ?? "";
		const title = xmlText(block, "title");
		const idUrl = xmlText(block, "id");
		const arxivId = /\/abs\/((?:[^/\s?#]+\/)?[^/\s?#]+)(?:[?#][^\s]*)?$/u.exec(idUrl)?.[1] ?? "";
		if (title === "" || arxivId === "") return [];
		const authors = [...block.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gu)].flatMap((author) => {
			const name = xmlText(author[1] ?? "", "name");
			return name === "" ? [] : [name];
		});
		const published = xmlText(block, "published");
		return [{
			source: "arxiv",
			id: arxivId,
			title,
			authors,
			year: /^(\d{4})-/u.exec(published)?.[1] === void 0 ? void 0 : Number(published.slice(0, 4)),
			container: "arXiv",
			doi: xmlText(block, "arxiv:doi").toLowerCase(),
			type: "preprint",
			url: idUrl
		}];
	});
}
function dataciteDoiUrl(doi) {
	return `https://api.datacite.org/dois/${encodeURIComponent(doi)}`;
}
function parseDataciteWork(raw) {
	if (!isRecord(raw)) return void 0;
	const data = isRecord(raw["data"]) ? raw["data"] : raw;
	const attributes = isRecord(data["attributes"]) ? data["attributes"] : void 0;
	if (attributes === void 0) return void 0;
	const title = Array.isArray(attributes["titles"]) ? attributes["titles"].flatMap((entry) => isRecord(entry) && typeof entry["title"] === "string" ? [entry["title"].trim()] : [])[0] ?? "" : "";
	const doi = typeof attributes["doi"] === "string" ? attributes["doi"].trim().toLowerCase() : "";
	if (title === "" && doi === "") return void 0;
	const authors = Array.isArray(attributes["creators"]) ? attributes["creators"].flatMap((creator) => {
		if (!isRecord(creator)) return [];
		const name = typeof creator["name"] === "string" ? creator["name"] : "";
		if (name !== "") return [name];
		const family = typeof creator["familyName"] === "string" ? creator["familyName"] : "";
		const given = typeof creator["givenName"] === "string" ? creator["givenName"] : "";
		return family === "" ? [] : [given === "" ? family : `${family}, ${given}`];
	}) : [];
	const types = isRecord(attributes["types"]) ? attributes["types"] : void 0;
	return {
		source: "datacite",
		id: doi,
		title,
		authors,
		year: yearOf(attributes["publicationYear"]),
		container: typeof attributes["publisher"] === "string" ? attributes["publisher"] : "",
		doi,
		type: types !== void 0 && typeof types["resourceTypeGeneral"] === "string" ? types["resourceTypeGeneral"] : "",
		url: typeof attributes["url"] === "string" ? attributes["url"] : doi === "" ? "" : `https://doi.org/${doi}`
	};
}
/**
* Raised when a registry answers `200` with something that is not the payload
* we asked for (HTML error page, wrong envelope, truncated XML).
*
* This exists because the earlier code let such a body parse to `[]`, which the
* transport then counted as "source answered, no match" — a transient outage
* would be persisted as a confident `quarantined + no-source-hit`. A body we
* cannot understand is an error, never a negative result.
*/
var SourceBodyError = class extends Error {
	source;
	detail;
	constructor(source, detail) {
		super(`${source}: ${detail}`);
		this.name = "SourceBodyError";
		this.source = source;
		this.detail = detail;
	}
};
function jsonEnvelope(source, body) {
	let raw;
	try {
		raw = JSON.parse(body);
	} catch {
		throw new SourceBodyError(source, "body is not JSON");
	}
	if (!isRecord(raw)) throw new SourceBodyError(source, "body is not a JSON object");
	return raw;
}
function pubmedIdUrl(pmid) {
	return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json&tool=dsh-refkeeper`;
}
function pmcSearchUrl(pmcid) {
	return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(`${pmcid.toUpperCase()}[pmc]`)}&retmode=json&tool=dsh-refkeeper`;
}
function pmcSummaryUrl(uid) {
	return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${encodeURIComponent(uid)}&retmode=json&tool=dsh-refkeeper`;
}
function openlibraryIsbnUrl(isbn, options) {
	return withMailto(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(`ISBN:${isbn}`)}&format=json&jscmd=data`, options);
}
function cleanPubMedTitle(value) {
	if (typeof value !== "string") return "";
	return value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().replace(/\.$/u, "").trim();
}
function pubmedAuthorName(value) {
	const name = textOf(value);
	if (name === void 0 || name.includes(",")) return name;
	const match = /^(.+)\s+(\S+)$/u.exec(name);
	return match === null ? name : `${match[1]}, ${match[2]}`;
}
function pubmedYear(value) {
	if (typeof value !== "string") return void 0;
	const match = /\b(\d{4})\b/u.exec(value);
	return match === null ? void 0 : Number(match[1]);
}
/** Parse the ESearch db=pmc response to its internal PMC UID (not a PMID). */
function parsePmcSearchUid(json) {
	const raw = jsonEnvelope("pubmed", json);
	const result = isRecord(raw["esearchresult"]) ? raw["esearchresult"] : void 0;
	if (result === void 0 || !Array.isArray(result["idlist"])) throw new SourceBodyError("pubmed", "missing esearchresult.idlist[]");
	const ids = result["idlist"];
	if (!ids.every((id) => typeof id === "string" && /^\d+$/u.test(id))) throw new SourceBodyError("pubmed", "esearch result contains invalid PMC UIDs");
	return ids[0];
}
/** PMC ESummary uses an internal UID; extract its linked PubMed identifier. */
function parsePmcSummaryPmid(json, uid) {
	const raw = jsonEnvelope("pubmed", json);
	const result = isRecord(raw["result"]) ? raw["result"] : void 0;
	const work = result !== void 0 && isRecord(result[uid]) ? result[uid] : void 0;
	if (work === void 0) throw new SourceBodyError("pubmed", "missing PMC summary record");
	const articleids = work["articleids"];
	if (!Array.isArray(articleids)) throw new SourceBodyError("pubmed", "missing PMC articleids[]");
	const pmid = articleids.find((entry) => isRecord(entry) && entry["idtype"] === "pmid" && typeof entry["value"] === "string");
	const value = isRecord(pmid) ? textOf(pmid["value"]) : void 0;
	if (value === void 0 || !/^\d{6,8}$/u.test(value)) throw new SourceBodyError("pubmed", "PMC summary has no valid PMID");
	return value;
}
/** Parse one or more PubMed ESummary records into the verifier's common shape. */
/**
* PubMed's `pubtype` mixes publication kinds with study design — a record can
* read `["Comparative Study", "Journal Article", "Research Support, Non-U.S.
* Gov't"]`. The first entry is therefore not the document type. Pick the first
* recognised publication kind and map it onto the reference types the exporters
* know; anything unrecognised falls back to a journal article.
*/
const PUBMED_REF_TYPE = {
	"journal article": "journalArticle",
	review: "journalArticle",
	"review article": "journalArticle",
	"systematic review": "journalArticle",
	letter: "journalArticle",
	comment: "journalArticle",
	editorial: "journalArticle",
	news: "journalArticle",
	"book review": "journalArticle",
	"published erratum": "journalArticle",
	book: "book",
	"book chapter": "book",
	monograph: "book",
	conference: "conferencePaper",
	"conference paper": "conferencePaper",
	"congress": "conferencePaper",
	"proceedings": "conferencePaper",
	preprint: "preprint",
	thesis: "thesis",
	dissertation: "thesis",
	report: "report",
	"technical report": "report",
	"working paper": "report",
	webpage: "webpage",
	"internet resource": "webpage",
	"database": "webpage"
};
function pubmedRefType(pubtypes) {
	for (const raw of pubtypes) {
		const hit = PUBMED_REF_TYPE[raw.trim().toLowerCase()];
		if (hit !== void 0) return hit;
	}
	return "journalArticle";
}
function parsePubMedSummary(json) {
	const raw = jsonEnvelope("pubmed", json);
	const result = isRecord(raw["result"]) ? raw["result"] : void 0;
	if (result === void 0 || !Array.isArray(result["uids"])) throw new SourceBodyError("pubmed", "missing result.uids[]");
	const uids = result["uids"];
	if (!uids.every((uid) => typeof uid === "string" && /^\d{6,8}$/u.test(uid))) throw new SourceBodyError("pubmed", "summary contains invalid PMID values");
	return uids.map((uid) => {
		const work = result[uid];
		if (!isRecord(work)) throw new SourceBodyError("pubmed", "missing summary record");
		const title = cleanPubMedTitle(work["title"]);
		if (title === "") throw new SourceBodyError("pubmed", "summary record has no title");
		const authors = Array.isArray(work["authors"]) ? work["authors"].flatMap((author) => {
			if (!isRecord(author)) return [];
			const name = pubmedAuthorName(author["name"]);
			return name === void 0 ? [] : [name];
		}) : [];
		const doiEntry = (Array.isArray(work["articleids"]) ? work["articleids"] : []).find((entry) => isRecord(entry) && entry["idtype"] === "doi");
		const doi = isRecord(doiEntry) ? textOf(doiEntry["value"])?.replace(/^doi:\s*/iu, "").toLowerCase() ?? "" : "";
		const lang = Array.isArray(work["lang"]) ? strings(work["lang"])[0] : void 0;
		return {
			source: "pubmed",
			id: uid,
			title,
			authors,
			year: pubmedYear(work["pubdate"]),
			container: textOf(work["fulljournalname"]) ?? textOf(work["source"]) ?? "",
			doi,
			type: pubmedRefType(Array.isArray(work["pubtype"]) ? strings(work["pubtype"]) : []),
			url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
			volume: textOf(work["volume"]),
			issue: textOf(work["issue"]),
			pages: textOf(work["pages"]),
			language: lang
		};
	});
}
function workOfWork(source, raw) {
	const work = isRecord(raw["message"]) ? raw["message"] : raw;
	if (!isRecord(work)) throw new SourceBodyError(source, "no work object in response");
	return work;
}
/** XML prologue we tolerate before the root element: declaration, comments, whitespace. */
const ATOM_PROLOGUE = /^\s*(?:<\?xml\b[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/u;
const XML_COMMENTS = /<!--[\s\S]*?-->/gu;
/** `<name …>`, `</name>`, `<name … />`; attribute values may contain `>`. */
const XML_TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gu;
/**
* Reject anything that is not a complete, well-nested Atom feed.
*
* Truncation shows up two ways, and both used to read as "source answered, no
* hits" — which could be persisted as `quarantined + no-source-hit`:
*   1. the closing `</feed>` is missing;
*   2. an inner element is cut or mis-nested while `</feed>` still arrives
*      (`<feed><entry><title>cut</entry></feed>`), leaving `parseArxivFeed`
*      with zero complete entries.
*
* The stack pass below only proves tag balance — it is not a general XML
* parser. Bodies that fail it are treated as damaged, which is the safe
* direction: a retryable `source-error` instead of a permanent verdict.
*/
function assertAtomFeed(source, body) {
	const xml = body.replace(ATOM_PROLOGUE, "").replace(XML_COMMENTS, "");
	const root = /^<feed\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/u.exec(xml);
	if (root === null) throw new SourceBodyError(source, "body is not an Atom feed");
	const attributes = root[1] ?? "";
	if (!/\bxmlns\s*=\s*(?:"http:\/\/www\.w3\.org\/2005\/Atom"|'http:\/\/www\.w3\.org\/2005\/Atom')/u.test(attributes)) throw new SourceBodyError(source, "Atom feed is missing the Atom namespace");
	if (!/<\/feed\s*>/u.test(xml)) throw new SourceBodyError(source, "Atom feed is truncated (no closing </feed>)");
	const open = [];
	let cursor = 0;
	let rootSeen = false;
	for (const match of xml.matchAll(XML_TAG)) {
		const between = xml.slice(cursor, match.index);
		if (between.includes("<") || open.length === 0 && between.trim() !== "") throw new SourceBodyError(source, "body is not well-formed XML");
		cursor = match.index + match[0].length;
		const closing = match[1] === "/";
		const name = match[2] ?? "";
		const selfClosing = (match[3] ?? "").trimEnd().endsWith("/");
		if (closing) {
			const expected = open.pop();
			if (expected === void 0 || expected !== name) throw new SourceBodyError(source, `Atom feed is malformed (unexpected </${name}>)`);
		} else {
			if (open.length === 0) {
				if (rootSeen) throw new SourceBodyError(source, "Atom feed has multiple root elements");
				rootSeen = true;
			}
			if (!selfClosing) open.push(name);
		}
	}
	const tail = xml.slice(cursor);
	if (tail.includes("<") || open.length === 0 && tail.trim() !== "") throw new SourceBodyError(source, "body is not well-formed XML");
	if (!rootSeen) throw new SourceBodyError(source, "body is not an Atom feed");
	const unclosed = open.at(-1);
	if (unclosed !== void 0) throw new SourceBodyError(source, `Atom feed is truncated (unclosed <${unclosed}>)`);
	return xml;
}
const OPEN_LIBRARY_SUFFIX = /(?:,\s*|\s+)(?:Jr|Sr|II|III|IV|V|VI|Ph\.?D|M\.?D|D\.?O|D\.?D\.?S|D\.?V\.?M|Esq|Ed\.?D)\.?$/iu;
function openLibraryAuthorName(value) {
	const withoutSuffix = value.trim().replace(OPEN_LIBRARY_SUFFIX, "").replace(/,\s*$/u, "").trim();
	return formatAuthorName(withoutSuffix);
}
function parseOpenLibraryBody(body) {
	const raw = jsonEnvelope("openlibrary", body);
	const records = [];
	for (const item of Object.values(raw)) {
		if (!isRecord(item)) continue;
		const title = textOf(item["title"]) ?? textOf(item["subtitle"]);
		if (title === void 0) continue;
		const identifiers = isRecord(item["identifiers"]) ? item["identifiers"] : void 0;
		const identifier = identifiers === void 0 ? void 0 : strings(identifiers["openlibrary"])[0];
		const key = textOf(item["key"]);
		const id = identifier ?? key?.split("/").filter(Boolean).at(-1);
		if (id === void 0 || id === "") continue;
		const authors = Array.isArray(item["authors"]) ? item["authors"].flatMap((author) => {
			if (!isRecord(author)) return [];
			const name = textOf(author["name"]);
			return name === void 0 ? [] : [openLibraryAuthorName(name)];
		}) : [];
		const firstPublisher = (Array.isArray(item["publishers"]) ? item["publishers"] : []).find(isRecord);
		const publisher = firstPublisher === void 0 ? void 0 : textOf(firstPublisher["name"]);
		const yearText = textOf(item["publish_date"])?.match(/\d{4}/u)?.[0];
		const year = yearText === void 0 ? void 0 : Number(yearText);
		const url = textOf(item["url"]) ?? (key?.startsWith("/") === true ? `https://openlibrary.org${key}` : key) ?? "";
		records.push({
			source: "openlibrary",
			id,
			title,
			authors,
			year,
			container: publisher ?? "",
			doi: "",
			type: "book",
			url,
			...publisher === void 0 ? {} : { publisher }
		});
	}
	return records;
}
/**
* Parse a registry body, distinguishing "valid envelope, no records" from
* "this is not the payload we expected".
*
* The distinction is the whole point: only the first may count as a source
* answering, so only the first can produce `no-source-hit`.
*/
function parseSourceBody(source, basis, body) {
	if (source === "arxiv") {
		const xml = assertAtomFeed(source, body);
		const records = parseArxivFeed(xml);
		const entryCount = [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?entry\b/giu)].length;
		if (records.length !== entryCount) throw new SourceBodyError(source, "Atom feed has entries that could not be read");
		return records;
	}
	if (source === "datacite") {
		const raw = jsonEnvelope(source, body);
		if (basis === "search") {
			const results = raw["data"];
			if (!Array.isArray(results)) throw new SourceBodyError(source, "missing data[]");
			const records = [];
			for (const item of results) {
				if (!isRecord(item) || !isRecord(item["attributes"])) throw new SourceBodyError(source, "search response contains unreadable results");
				const record = parseDataciteWork({ data: item });
				if (record === void 0) throw new SourceBodyError(source, "search response contains unreadable results");
				records.push(record);
			}
			return records;
		}
		if (!isRecord((isRecord(raw["data"]) ? raw["data"] : raw)["attributes"])) throw new SourceBodyError(source, "missing data.attributes");
		const record = parseDataciteWork(raw);
		if (record === void 0) throw new SourceBodyError(source, "work has neither DOI nor title");
		return [record];
	}
	if (source === "openalex") {
		const raw = jsonEnvelope(source, body);
		if (basis === "search") {
			const results = raw["results"];
			if (!Array.isArray(results)) throw new SourceBodyError(source, "missing results[]");
			const records = parseOpenAlexSearch(raw);
			if (records.length !== results.length) throw new SourceBodyError(source, "search response contains unreadable results");
			return records;
		}
		if (typeof raw["id"] !== "string" && typeof raw["doi"] !== "string" && typeof raw["display_name"] !== "string" && typeof raw["title"] !== "string") throw new SourceBodyError(source, "no work object in response");
		const record = parseOpenAlexWork(raw);
		if (record === void 0) throw new SourceBodyError(source, "work has neither DOI nor title");
		return [record];
	}
	if (source === "pubmed") {
		if (basis !== "id") throw new SourceBodyError(source, "only exact-ID lookups are supported");
		return parsePubMedSummary(body);
	}
	if (source === "openlibrary") {
		if (basis !== "id") throw new SourceBodyError(source, "only exact-ID lookups are supported");
		return parseOpenLibraryBody(body);
	}
	const raw = jsonEnvelope(source, body);
	if (basis === "search") {
		const items = (isRecord(raw["message"]) ? raw["message"] : raw)["items"];
		if (!Array.isArray(items)) throw new SourceBodyError(source, "missing message.items[]");
		const records = parseCrossrefSearch(raw);
		if (records.length !== items.length) throw new SourceBodyError(source, "search response contains unreadable items");
		return records;
	}
	const work = workOfWork(source, raw);
	if (!(typeof work["DOI"] === "string" && work["DOI"].trim() !== "") && strings(work["title"]).length === 0) throw new SourceBodyError(source, "work has neither DOI nor title");
	const record = parseCrossrefWork(raw);
	if (record === void 0) throw new SourceBodyError(source, "work has neither DOI nor title");
	return [record];
}
const DEFAULT_CACHE_TTL_MS = 6e5;
/** Tiny TTL cache keyed by URL; only successful responses are stored. */
var LookupCache = class {
	entries = /* @__PURE__ */ new Map();
	ttlMs;
	constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
		this.ttlMs = ttlMs;
	}
	get(url, now) {
		const entry = this.entries.get(url);
		if (entry === void 0) return void 0;
		if (entry.expiresAt <= now) {
			this.entries.delete(url);
			return;
		}
		return entry.body;
	}
	set(url, body, now) {
		this.entries.set(url, {
			body,
			expiresAt: now + this.ttlMs
		});
	}
	get size() {
		return this.entries.size;
	}
};
const defaultFetcher = async (url, init) => {
	const response = await fetch(url, init.signal === void 0 ? {} : { signal: init.signal });
	return {
		ok: response.ok,
		status: response.status,
		body: await response.text(),
		headers: response.headers
	};
};
function sleepMs(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
const NCBI_EUTILS_PREFIX = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const NCBI_MIN_REQUEST_INTERVAL_MS = Math.ceil(1e3 / 3);
let lastNcbiRequestAt = 0;
let ncbiRequestQueue = Promise.resolve();
function throwIfAborted(signal) {
	if (signal?.aborted === true) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
/** Serialize all E-utilities requests in this process to at most 3 per second. */
async function waitForNcbiRequest(signal) {
	const previous = ncbiRequestQueue;
	let release = () => {};
	ncbiRequestQueue = new Promise((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		throwIfAborted(signal);
		const waitMs = Math.max(0, lastNcbiRequestAt + NCBI_MIN_REQUEST_INTERVAL_MS - Date.now());
		if (waitMs > 0) await sleepMs(waitMs);
		throwIfAborted(signal);
		lastNcbiRequestAt = Date.now();
	} finally {
		release();
	}
}
var AttemptTimeout = class extends Error {
	constructor() {
		super("attempt timed out");
	}
};
/** A 4xx that retrying cannot fix (400, 403, 404). */
var PermanentHttpError = class extends Error {
	status;
	constructor(status) {
		super(`HTTP ${String(status)}`);
		this.status = status;
	}
};
async function withTimeout(work, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new AttemptTimeout()), ms);
		if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
* Fetch with a per-attempt timeout that actually cancels the request.
*
* Racing a promise against a timer only stops *waiting*; the socket and the
* response body keep going. For a 4s budget over three registries that is three
* orphaned requests per verification, so the timer aborts the controller.
*/
async function fetchWithTimeout(fetcher, url, ms, outer) {
	if (outer?.aborted === true) throw outer.reason ?? new DOMException("The operation was aborted", "AbortError");
	const controller = new AbortController();
	let didTimeout = false;
	let onAbort;
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			didTimeout = true;
			reject(new AttemptTimeout());
			controller.abort();
		}, ms);
		if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
	});
	const callerAbort = outer === void 0 ? void 0 : new Promise((_, reject) => {
		onAbort = () => {
			controller.abort(outer.reason);
			reject(outer.reason ?? new DOMException("The operation was aborted", "AbortError"));
		};
		outer.addEventListener("abort", onAbort, { once: true });
	});
	try {
		const work = fetcher(url, { signal: controller.signal }).catch((error) => {
			if (didTimeout) throw new AttemptTimeout();
			throw error;
		});
		return await Promise.race(callerAbort === void 0 ? [work, timeout] : [
			work,
			timeout,
			callerAbort
		]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		if (outer !== void 0 && onAbort !== void 0) outer.removeEventListener("abort", onAbort);
	}
}
const MAX_RETRY_DELAY_MS = 4e3;
function retryAfterDelayMs(result, now) {
	const value = result.headers?.get("retry-after")?.trim();
	if (value === void 0 || value === "") return void 0;
	if (/^\d+$/u.test(value)) {
		const delayMs = Number(value) * 1e3;
		return Number.isFinite(delayMs) ? delayMs : void 0;
	}
	const retryAt = Date.parse(value);
	return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : void 0;
}
function fallbackRetryDelayMs(attempt, initialDelayMs) {
	const multiplier = attempt === 0 ? 1 : 2 ** (attempt + 1);
	return Math.min(initialDelayMs * multiplier, MAX_RETRY_DELAY_MS);
}
/** GET one URL with cache, per-attempt timeout and 429/5xx retry. */
async function fetchText(url, options) {
	const cached = options.cache?.get(url, options.now());
	if (cached !== void 0) return cached;
	let lastError;
	for (let attempt = 0; attempt <= options.retries; attempt += 1) {
		let serverRetryAfterMs;
		try {
			if (url.startsWith(NCBI_EUTILS_PREFIX)) await waitForNcbiRequest(options.signal);
			const result = await fetchWithTimeout(options.fetcher, url, options.timeoutMs, options.signal);
			if (result.ok) return result.body;
			if (result.status !== 429 && result.status < 500) throw new PermanentHttpError(result.status);
			lastError = /* @__PURE__ */ new Error(`HTTP ${String(result.status)}`);
			serverRetryAfterMs = retryAfterDelayMs(result, options.now());
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted || error instanceof AttemptTimeout || error instanceof PermanentHttpError || error instanceof Error && error.name === "AbortError") throw error;
		}
		if (attempt < options.retries) await options.sleep(serverRetryAfterMs ?? fallbackRetryDelayMs(attempt, options.retryDelayMs));
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function dedupe(records) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const record of records) {
		const key = `${record.source}|${record.id}|${record.doi}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(record);
	}
	return out;
}
function tasksFor(identity, mailto) {
	const contact = mailto === void 0 ? void 0 : { mailto };
	const pmid = identity.pmid?.trim();
	const pmcid = identity.pmcid?.trim();
	const doi = identity.doi?.trim();
	const arxivId = identity.arxivId?.trim();
	const reportNumber = identity.reportNumber?.trim();
	const isbn = identity.isbn?.replace(/[-\s]/gu, "");
	const title = identity.title?.trim();
	const hasPubMedId = pmid !== void 0 && pmid !== "";
	const hasPmcId = pmcid !== void 0 && pmcid !== "";
	if (doi !== void 0 && doi !== "") return [
		{
			source: "crossref",
			url: crossrefDoiUrl(doi, contact),
			basis: "doi"
		},
		{
			source: "datacite",
			url: dataciteDoiUrl(doi),
			basis: "doi"
		},
		{
			source: "openalex",
			url: openalexDoiUrl(doi, contact),
			basis: "doi"
		}
	];
	if (arxivId !== void 0 && arxivId !== "") return [{
		source: "arxiv",
		url: arxivIdUrl(arxivId),
		basis: "id"
	}];
	if (hasPubMedId) return [{
		source: "pubmed",
		url: pubmedIdUrl(pmid),
		basis: "id"
	}];
	if (hasPmcId) return [{
		source: "pubmed",
		url: pmcSearchUrl(pmcid),
		basis: "id",
		pmcid
	}];
	if (isbn !== void 0 && (isValidIsbn10(isbn) || isValidIsbn13(isbn))) return [{
		source: "openlibrary",
		url: openlibraryIsbnUrl(isbn, contact),
		basis: "id"
	}];
	if (reportNumber !== void 0 && reportNumber !== "") return [{
		source: "datacite",
		url: dataciteQueryUrl(reportNumber, contact),
		basis: "search"
	}];
	if (title !== void 0 && title !== "") return [
		{
			source: "crossref",
			url: crossrefSearchUrl(title, 5, contact),
			basis: "search"
		},
		{
			source: "openalex",
			url: openalexSearchUrl(title, 5, contact),
			basis: "search"
		},
		{
			source: "arxiv",
			url: arxivSearchUrl(title, 5),
			basis: "search"
		}
	];
	return [];
}
/**
* Query the registries for one identity.
*
* Sources run concurrently; when the total budget expires the already-settled
* results are kept and `timedOut` is set, so a slow registry costs precision
* (⚠ region) rather than blocking the capture.
*/
async function lookupRecords(identity, options = {}) {
	const tasks = tasksFor(identity, options.mailto);
	if (tasks.length === 0) return {
		records: [],
		errors: [],
		timedOut: false,
		answered: []
	};
	const fetcher = options.fetcher ?? defaultFetcher;
	const cache = options.cache;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? sleepMs;
	const retries = options.retries ?? 2;
	const retryDelayMs = options.retryDelayMs ?? 250;
	const sourceTimeoutMs = options.sourceTimeoutMs ?? 4e3;
	const totalBudgetMs = options.totalBudgetMs ?? 8e3;
	const lookupController = new AbortController();
	const callerSignal = options.signal;
	const forwardAbort = () => lookupController.abort(callerSignal?.reason);
	if (callerSignal?.aborted === true) forwardAbort();
	else callerSignal?.addEventListener("abort", forwardAbort, { once: true });
	const fetchOptions = {
		fetcher,
		cache,
		now,
		sleep,
		retries,
		retryDelayMs,
		timeoutMs: sourceTimeoutMs,
		signal: lookupController.signal
	};
	const run = async (task) => {
		try {
			if (task.pmcid !== void 0) {
				const searchBody = await fetchText(task.url, fetchOptions);
				const uid = parsePmcSearchUid(searchBody);
				cache?.set(task.url, searchBody, now());
				if (uid === void 0) return {
					source: task.source,
					records: []
				};
				const pmcUrl = pmcSummaryUrl(uid);
				const pmcBody = await fetchText(pmcUrl, fetchOptions);
				const pmid = parsePmcSummaryPmid(pmcBody, uid);
				cache?.set(pmcUrl, pmcBody, now());
				const pubmedUrl = pubmedIdUrl(pmid);
				const pubmedBody = await fetchText(pubmedUrl, fetchOptions);
				const records = parsePubMedSummary(pubmedBody);
				cache?.set(pubmedUrl, pubmedBody, now());
				return {
					source: task.source,
					records
				};
			}
			const body = await fetchText(task.url, fetchOptions);
			const records = parseSourceBody(task.source, task.basis, body);
			cache?.set(task.url, body, now());
			return {
				source: task.source,
				records
			};
		} catch (error) {
			if (error instanceof PermanentHttpError && error.status === 404) return {
				source: task.source,
				records: []
			};
			return {
				source: task.source,
				error
			};
		}
	};
	try {
		const settled = await settleWithin(tasks.map(run), totalBudgetMs, () => {
			lookupController.abort(new AttemptTimeout());
		});
		const records = [];
		const errors = [];
		const answered = [];
		let timedOut = settled.timedOut;
		for (const [index, outcome] of settled.values.entries()) {
			const task = tasks[index];
			if (task === void 0) continue;
			if (outcome === void 0) {
				timedOut = true;
				errors.push(task.source);
				continue;
			}
			if (outcome.error !== void 0) {
				if (outcome.error instanceof AttemptTimeout) timedOut = true;
				errors.push(outcome.source);
				continue;
			}
			answered.push(outcome.source);
			records.push(...outcome.records ?? []);
		}
		return {
			records: dedupe(records),
			errors,
			timedOut,
			answered
		};
	} finally {
		callerSignal?.removeEventListener("abort", forwardAbort);
	}
}
/** Await every promise, but stop waiting after `budgetMs`; unresolved become `undefined`. */
async function settleWithin(promises, budgetMs, onTimeout) {
	const values = promises.map(() => void 0);
	let timedOut = false;
	await Promise.all(promises.map(async (promise, index) => {
		try {
			values[index] = await withTimeout(promise, budgetMs);
		} catch (error) {
			if (error instanceof AttemptTimeout && !timedOut) {
				timedOut = true;
				onTimeout();
			}
			values[index] = void 0;
		}
	}));
	return {
		values,
		timedOut
	};
}
/** Look the candidate up and judge it. The only network entry point in M2. */
async function verifyCandidate(input, options = {}) {
	const candidate = {
		title: input.title ?? "",
		authors: input.authors ?? [],
		year: input.year,
		doi: input.doi ?? "",
		arxivId: input.arxivId ?? "",
		pmid: input.pmid ?? "",
		pmcid: input.pmcid ?? "",
		reportNumber: input.reportNumber ?? "",
		isbn: input.isbn ?? "",
		url: input.url ?? ""
	};
	const lookup = await lookupRecords({
		doi: candidate.doi,
		arxivId: candidate.arxivId,
		pmid: candidate.pmid,
		pmcid: candidate.pmcid,
		reportNumber: candidate.reportNumber,
		isbn: candidate.isbn,
		url: candidate.url,
		title: candidate.title
	}, options);
	const hasExistingIdentifier = candidate.doi !== "" || candidate.arxivId !== "" || candidate.pmid !== "" || candidate.pmcid !== "";
	const claim = candidate.title.trim() === "" && hasExistingIdentifier && lookup.records.length > 0 ? {
		...candidate,
		title: lookup.records[0]?.title ?? "",
		authors: lookup.records[0]?.authors ?? [],
		year: lookup.records[0]?.year
	} : candidate;
	return {
		report: judgeCandidate({
			candidate: claim,
			records: lookup.records,
			errors: lookup.errors,
			timedOut: lookup.timedOut,
			answered: lookup.answered
		}),
		records: lookup.records,
		lookup
	};
}
// src/index.ts
/** Package identity used by diagnostics and the client registrant label. */
const verifyCache = new LookupCache();
/**
* Human label for the scope flags on a `/refs capture …` line, reused for the
* persisted batch so the panel can show what was captured.
*/
function scopeLabelOf(raw) {
	const parsed = parseRefsCommand(raw);
	if ("error" in parsed) return "last capture";
	const scope = parseScope(parsed.scopeArg, parsed.turnsArg);
	return "error" in scope ? "last capture" : describeScope(scope);
}
function oneLineError(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 240) || "unknown error";
}
const PACKAGE_NAME = "dsh-refkeeper";
/** Cordis service key this plugin provides. */
const SERVICE_KEY = "refkeeper";
/**
* Reports which SDK build the plugin is actually running against.
*
* The host version is deliberately not read from `package.json` top-level
* `version` (that is the plugin's own), and not assumed from an env var (the
* desktop app does not export one). Resolving the peer package that carries
* the tool/session contracts answers the question that matters: which API
* surface is live in this process.
*/
function probeSdkVersion() {
	const fromEnv = process.env["DSH_VERSION"];
	if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
	try {
		return createRequire(import.meta.url)("@deepseek-ai/dsh-tools/package.json").version;
	} catch {
		return;
	}
}
const probeSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		plugin: { type: "string" },
		dshVersion: { type: "string" },
		agent: { type: "boolean" },
		sessionId: { type: "string" },
		cwd: { type: "string" },
		surfaceNodes: { type: "integer" },
		firstSeq: { type: "integer" },
		lastSeq: { type: "integer" },
		turnStarts: { type: "integer" },
		currentTurnStartSeq: { type: "integer" },
		currentTurnEvents: { type: "integer" },
		nodeTypes: { type: "string" },
		outlineTurns: { type: "integer" },
		turnOutline: { type: "string" },
		writeOk: { type: "boolean" },
		writePath: { type: "string" },
		writeError: { type: "string" }
	}
};
function errorCode(error) {
	if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
	return error instanceof Error ? error.message : String(error);
}
async function writeProbe(cwd) {
	if (cwd === "") return {
		writeOk: false,
		writePath: "",
		writeError: "no-cwd"
	};
	const dir = join(cwd, ".refkeeper");
	const path = join(dir, "probe.json");
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(path, `${JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString() })}\n`, "utf8");
		return {
			writeOk: true,
			writePath: path,
			writeError: ""
		};
	} catch (error) {
		return {
			writeOk: false,
			writePath: path,
			writeError: errorCode(error)
		};
	}
}
/** Set when the host exposes `sessionProjections`; `undefined` on hosts without it. */
let projections;
/**
* Set when the host exposes `sessionQuery`. This is the sanctioned async read
* seam for the session log (turn boundaries + event payloads); when absent, the
* capture paths degrade loudly instead of guessing.
*/
let sessionQuery;
let directoryPickerController;
let hostFs;
let llmService;
let defaultModelService;
/**
* `currentSelection()` returns a detached model selection whose shape belongs to
* the host; only provider and model matter here, and they are read defensively.
*/
function routeOf(selection) {
	if (typeof selection !== "object" || selection === null) return void 0;
	const raw = selection;
	const provider = typeof raw["provider"] === "string" ? raw["provider"] : void 0;
	const model = typeof raw["model"] === "string" ? raw["model"] : void 0;
	return provider === void 0 || model === void 0 ? void 0 : {
		provider,
		model
	};
}
/**
* Optional host services may mount after this plugin's constructor runs, so a
* value captured at mount time can stay undefined for the whole process. Probe
* again on demand instead of trusting the first look.
*/
let serviceLookup;
/**
* Turn boundaries from the `turnOutline` projection.
*
* The persisted event log can be segmented, so a long session's older
* `turn/start` events may not be visible through `sessionQuery.listEvents`.
* The projection is folded by the host itself and therefore still knows them.
*/
function outlineTurnStarts(session) {
	if (session === void 0 || projections === void 0) return void 0;
	const turns = projections.stateOf(session, "turnOutline")?.turns;
	if (turns === void 0 || turns.length === 0) return void 0;
	return turns.map((entry) => entry.seq);
}
/** Diagnostic tool: reports the live-session contract this plugin builds on. */
const refPingTool = defineTool({
	name: "ref_ping",
	description: "Diagnose the dsh-refkeeper plugin: report whether the tool can reach the live session, how many model-visible surface nodes and turns it sees, and whether the session workspace is writable from a tool. Reads only; writes at most .refkeeper/probe.json inside the session workspace.",
	parameters: {},
	output: {
		schema: probeSchema,
		render(_args, value) {
			return [{
				type: "text",
				text: [
					`plugin: ${value.plugin}`,
					`dsh: ${value.dshVersion}`,
					`agent: ${value.agent}`,
					`session: ${value.sessionId === "" ? "(none)" : value.sessionId}`,
					`cwd: ${value.cwd === "" ? "(none)" : value.cwd}`,
					`surface nodes: ${value.surfaceNodes} (seq ${value.firstSeq}..${value.lastSeq})`,
					`turns: ${value.turnStarts} total, current turn starts at seq ${value.currentTurnStartSeq} with ${value.currentTurnEvents} events`,
					`node types: ${value.nodeTypes}`,
					`turnOutline: ${value.outlineTurns === -1 ? "(unit not registered)" : `${value.outlineTurns} turn(s) [${value.turnOutline}]`}`,
					`workspace write: ${value.writeOk ? "ok" : `failed (${value.writeError})`}${value.writePath === "" ? "" : ` at ${value.writePath}`}`
				].join("\n")
			}];
		}
	},
	async execute(_args, exec) {
		const agent = exec.agent;
		const session = agent?.session;
		const nodes = session?.surface.nodes ?? [];
		let turnStartSeqs = [];
		if (session !== void 0 && sessionQuery !== void 0) turnStartSeqs = (await sessionQuery.listEvents(session.id)).filter((record) => record.type === "turn/start").map((record) => record.seq);
		else if (session !== void 0) {
			for (const seq of nodes) if (session.eventAt(seq)?.type === "turn/start") turnStartSeqs.push(seq);
		}
		const currentTurnStartSeq = turnStartSeqs.at(-1);
		const currentTurnEvents = currentTurnStartSeq === void 0 ? 0 : nodes.filter((seq) => seq >= currentTurnStartSeq).length;
		const outline = session === void 0 || projections === void 0 ? void 0 : projections.stateOf(session, "turnOutline");
		const cwd = session?.header.cwd ?? "";
		const write = await writeProbe(cwd);
		return {
			plugin: PACKAGE_NAME,
			dshVersion: probeSdkVersion() ?? "unknown",
			agent: agent !== void 0,
			sessionId: session?.id ?? "",
			cwd,
			surfaceNodes: nodes.length,
			firstSeq: nodes.at(0) ?? -1,
			lastSeq: nodes.at(-1) ?? -1,
			turnStarts: turnStartSeqs.length,
			currentTurnStartSeq: currentTurnStartSeq ?? -1,
			currentTurnEvents,
			nodeTypes: session === void 0 ? "" : nodes.map((seq) => `${seq}:${session.eventAt(seq)?.type ?? "?"}`).join(" "),
			outlineTurns: outline === void 0 ? -1 : outline.turns?.length ?? 0,
			turnOutline: outline?.turns?.map((entry) => `${entry.turn}@${entry.seq}`).join(" ") ?? "",
			...write
		};
	}
});
/**
* Verification as a model-facing tool.
*
* Same three conditions as `/refs verify`: a title alone that "looks right" is
* not enough, and a candidate never becomes `verified` without a registry that
* actually returns the work. The ⚠ statuses are deliberately distinct so the
* model can say "the network failed, retry" instead of "this citation is fake".
*/
const refVerifyTool = defineTool({
	name: "ref_verify",
	description: "Identifier routing across Refkeeper: DOI→Crossref/DataCite/OpenAlex; arXiv id→arXiv; PMID→PubMed; PMCID→PMC search and PMID crosswalk; ISBN→Open Library; report number→DataCite; title-only→Crossref/OpenAlex/arXiv. ISBN and report-number routes are candidate discovery only and do not count as verification evidence. At most three sources are queried concurrently. The ref_verify inputs are title, authors, year, doi, arxivId, pmid and pmcid. The verdict is `verified` only when title strongly matches, year is within ±1, the first author matches AND at least one registry returns the work; `warning` (2/3), `quarantined` (0-1/3 or no registry hit) and `unverified` (registries unreachable) all belong in the ⚠ region and must not be exported. A bare DOI/arXiv id/PMID/PMCID with no title is an existence check: the matched record supplies the claim.",
	parameters: {
		title: {
			type: "string",
			description: "Claimed title, as written in the conversation."
		},
		authors: {
			type: "array",
			items: { type: "string" },
			description: "Claimed author names in citation order; only the first is compared."
		},
		year: {
			type: "integer",
			description: "Claimed publication year."
		},
		doi: {
			type: "string",
			description: "DOI without the https://doi.org/ prefix."
		},
		arxivId: {
			type: "string",
			description: "arXiv identifier, e.g. 2401.01234."
		},
		pmid: {
			type: "string",
			description: "PubMed identifier, e.g. 25882522."
		},
		pmcid: {
			type: "string",
			description: "PubMed Central identifier, e.g. PMC7840891."
		}
	},
	output: {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: {
				status: { type: "string" },
				passed: { type: "integer" },
				matchedSource: { type: "string" },
				partial: { type: "boolean" },
				reasonsJson: { type: "string" },
				reportJson: { type: "string" },
				note: { type: "string" }
			}
		},
		render(_args, value) {
			return [{
				type: "text",
				text: [
					`${value.status} · passed ${String(value.passed)}/3${value.matchedSource === "" ? "" : ` · matched ${value.matchedSource}`}${value.partial ? " · partial" : ""}`,
					value.reportJson,
					value.note
				].join("\n")
			}];
		}
	},
	async execute(args) {
		if ((args.title ?? "") === "" && (args.doi ?? "") === "" && (args.arxivId ?? "") === "" && (args.pmid ?? "") === "" && (args.pmcid ?? "") === "") return {
			status: "unverified",
			passed: 0,
			matchedSource: "",
			partial: false,
			reasonsJson: "[\"no-identity\"]",
			reportJson: JSON.stringify({
				status: "unverified",
				passed: 0,
				note: "Rejected: supply a title, a DOI, an arXiv id, a PMID or a PMCID. Verification needs an identity to look up."
			}),
			note: "Nothing was queried: the claim had no identity."
		};
		const outcome = await verifyCandidate({
			title: args.title,
			authors: args.authors,
			year: args.year,
			doi: args.doi,
			arxivId: args.arxivId,
			pmid: args.pmid,
			pmcid: args.pmcid
		}, { cache: verifyCache });
		const report = outcome.report;
		const note = report.status === "verified" ? "All three conditions passed against a live registry; this reference may enter the table." : report.status === "unverified" ? "The registries could not be reached; this is not evidence the citation is wrong. Retry later." : "Kept out of the main table: the claim is not confirmed by a registry (⚠ region).";
		return {
			status: report.status,
			passed: report.passed,
			matchedSource: report.matchedSource ?? "",
			partial: report.partial,
			reasonsJson: JSON.stringify(report.reasons),
			reportJson: JSON.stringify({
				report,
				records: outcome.lookup.records
			}),
			note
		};
	}
});
const captureSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		accepted: { type: "boolean" },
		scope: { type: "string" },
		readMode: { type: "string" },
		turns: { type: "integer" },
		messages: { type: "integer" },
		chars: { type: "integer" },
		truncated: { type: "boolean" },
		candidatesJson: { type: "string" },
		note: { type: "string" }
	}
};
/**
* Pass 3 of extraction: the model states what a reference is.
*
* Structured fields supplied here outrank regex guesses during merge, and
* `scope` optionally widens the answer with everything regex found in the same
* window so the model and the scanner never produce two competing tables.
*/
function workspaceOf(session) {
	return session?.header?.cwd ?? "";
}
function optionalService(name, current, remember) {
	if (current !== void 0) return current;
	if (serviceLookup === void 0) return void 0;
	try {
		const found = serviceLookup(name);
		if (found !== void 0) remember(found);
		return found;
	} catch {
		return;
	}
}
function storeDeps(cwd, signal) {
	const picker = optionalService("directoryPickerController", directoryPickerController, (value) => {
		directoryPickerController = value;
	});
	const fs = optionalService("fs", hostFs, (value) => {
		hostFs = value;
	});
	return {
		workspace: cwd,
		...picker === void 0 ? {} : { directoryPicker: picker },
		...fs === void 0 ? {} : { fs },
		...signal === void 0 ? {} : { signal },
		allowManualConfirm: false,
		resolveIdentifiers: async (doi, arxivId, pmid, pmcid, reportNumber, isbn, url) => {
			if (doi === "" && arxivId === "" && pmid === "" && pmcid === "" && isbn === "" && reportNumber === "") return void 0;
			const outcome = await verifyCandidate({
				...doi === "" ? {} : { doi },
				...arxivId === "" ? {} : { arxivId },
				...pmid === "" ? {} : { pmid },
				...pmcid === "" ? {} : { pmcid },
				...reportNumber === "" ? {} : { reportNumber },
				...isbn === "" ? {} : { isbn },
				...url === "" ? {} : { url }
			}, { cache: verifyCache });
			const wanted = doi.toLowerCase();
			return outcome.records.find((record) => (record.doi ?? "").toLowerCase() === wanted && wanted !== "") ?? outcome.records.find((record) => record.source === "arxiv" && record.id.toLowerCase() === arxivId.toLowerCase()) ?? outcome.records[0];
		},
		verify: async (ref) => {
			return (await verifyCandidate(verificationClaimOf(ref), { cache: verifyCache })).report;
		}
	};
}
const saveSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		accepted: { type: "boolean" },
		status: { type: "string" },
		id: { type: "string" },
		quarantined: { type: "boolean" },
		message: { type: "string" }
	}
};
const exportSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		ok: { type: "boolean" },
		message: { type: "string" }
	}
};
/** Persist one reference: verify first, then main table or ⚠ quarantine. */
const refSaveTool = defineTool({
	name: "ref_save",
	description: "Save one bibliographic reference to this workspace's refs/refs.json after running the three-condition verification (title + year ±1 + first author, all against a real registry record). Verified references enter the main table; anything else is written to refs/quarantine.json and excluded from export. Supply the annotation fields grounded in the conversation: summary (what the work says), relevance (why it matters for the user's task), evidence (the exact claim or quote from the conversation), caveats (limits the user should know).",
	parameters: {
		title: {
			type: "string",
			required: true,
			description: "Work title, in its original language."
		},
		authors: {
			type: "array",
			items: { type: "string" },
			description: "Author names in citation order."
		},
		year: {
			type: "integer",
			description: "Publication year."
		},
		type: {
			type: "string",
			enum: [
				"journalArticle",
				"conferencePaper",
				"preprint",
				"report",
				"thesis",
				"book",
				"webpage"
			],
			description: "Reference type; defaults to journalArticle."
		},
		doi: {
			type: "string",
			description: "DOI without the https://doi.org/ prefix."
		},
		arxivId: {
			type: "string",
			description: "arXiv identifier, e.g. 2401.01234."
		},
		isbn: {
			type: "string",
			description: "ISBN for books. On its own it cannot be verified — supply a title so the registries can be searched."
		},
		lccn: {
			type: "string",
			description: "Library of Congress Control Number for a book; stored as an identifier, not verification evidence."
		},
		oclc: {
			type: "string",
			description: "WorldCat OCLC number for a book; stored as an identifier, not verification evidence."
		},
		openlibraryId: {
			type: "string",
			description: "Open Library book ID (e.g. OL123M); stored as an identifier, not verification evidence."
		},
		reportNumber: {
			type: "string",
			description: "Technical report number, e.g. NUREG/CR-1234, PB123456. On its own it cannot be verified — supply a title, or the DOI if the report has one."
		},
		url: {
			type: "string",
			description: "Landing page URL. A URL carrying a DOI or arXiv id is resolved from it; one that does not cannot be verified."
		},
		container: {
			type: "string",
			description: "Journal, conference, publisher or report series."
		},
		volume: { type: "string" },
		issue: { type: "string" },
		pages: { type: "string" },
		language: {
			type: "string",
			description: "ISO 639-1 code when the work is not English, e.g. \"zh\"."
		},
		tags: {
			type: "array",
			items: { type: "string" }
		},
		summary: {
			type: "string",
			description: "Annotation: what the work says, in the user's language."
		},
		relevance: {
			type: "string",
			description: "Annotation: why it matters for the current task."
		},
		evidence: {
			type: "string",
			description: "Annotation: the conversation claim or quote that grounds it."
		},
		caveats: {
			type: "string",
			description: "Annotation: limits, biases or open questions."
		}
	},
	output: {
		schema: saveSchema,
		render(_args, value) {
			return [{
				type: "text",
				text: value.message
			}];
		}
	},
	async execute(args, exec) {
		const session = exec.agent?.session;
		const cwd = workspaceOf(session);
		if (cwd === "") return {
			accepted: false,
			status: "error",
			id: "",
			quarantined: false,
			message: "no workspace: the session has no cwd, so refs/ cannot be written."
		};
		const annotation = {
			...args.summary ? { summary: args.summary } : {},
			...args.relevance ? { relevance: args.relevance } : {},
			...args.evidence ? { evidence: args.evidence } : {},
			...args.caveats ? { caveats: args.caveats } : {},
			source: "model",
			status: "complete"
		};
		const payload = {
			title: args.title,
			authors: args.authors ?? [],
			...args.year !== void 0 ? { year: args.year } : {},
			type: args.type ?? "journalArticle",
			...args.doi ? { identifiers: { doi: args.doi } } : {},
			...args.arxivId ? { identifiers: { arxiv: args.arxivId } } : {},
			...args.isbn ? { identifiers: { isbn: args.isbn } } : {},
			...args.reportNumber ? { identifiers: { reportNumber: args.reportNumber } } : {},
			...args.container ? { containerTitle: args.container } : {},
			...args.volume ? { volume: args.volume } : {},
			...args.issue ? { issue: args.issue } : {},
			...args.pages ? { pages: args.pages } : {},
			...args.language ? { language: args.language } : {},
			...args.url ? { url: args.url } : {},
			...args.tags ? { tags: args.tags } : {},
			annotation,
			provenance: {
				...session && "id" in session ? {} : {},
				trigger: "tool",
				capturedAt: (/* @__PURE__ */ new Date()).toISOString()
			}
		};
		const ids = {
			doi: args.doi,
			arxiv: args.arxivId,
			isbn: args.isbn,
			lccn: args.lccn,
			oclc: args.oclc,
			openlibraryId: args.openlibraryId,
			reportNumber: args.reportNumber
		};
		const result = await saveFromPayload({
			...payload,
			identifiers: Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== void 0 && value !== ""))
		}, storeDeps(cwd));
		return {
			accepted: result.kind === "success",
			status: result.status ?? (result.kind === "success" ? "stored" : "error"),
			id: result.id ?? "",
			quarantined: result.quarantined === true,
			message: result.text
		};
	}
});
/** Export the library as BibTeX and/or RIS inside the workspace. */
const refExportTool = defineTool({
	name: "ref_export",
	description: "Export this workspace's verified references to refs/exports/ as BibTeX and/or RIS. Quarantined (⚠) entries are excluded unless includeQuarantine is true. Both exporters are deterministic: re-exporting an unchanged library yields identical bytes, which keeps diffs and golden tests meaningful.",
	parameters: {
		format: {
			type: "string",
			enum: [
				"bibtex",
				"ris",
				"both"
			],
			description: "Defaults to both."
		},
		out: {
			type: "string",
			description: "Workspace-relative path; only valid with a single format. Defaults to refs/exports/refs-<timestamp>.<ext>."
		},
		includeQuarantine: {
			type: "boolean",
			description: "Include ⚠ entries. Default false: they never leave the workspace by default."
		},
		all: {
			type: "boolean",
			description: "Export the whole library. Default false exports only the last capture batch (what the user just captured); pass true when the user asks for the complete bibliography."
		}
	},
	output: {
		schema: exportSchema,
		render(_args, value) {
			return [{
				type: "text",
				text: value.message
			}];
		}
	},
	async execute(args, exec) {
		const session = exec.agent?.session;
		const cwd = workspaceOf(session);
		if (cwd === "") return {
			ok: false,
			message: "no workspace: the session has no cwd."
		};
		const result = await exportLibrary({
			format: args.format ?? "both",
			...args.out ? { out: args.out } : {},
			includeQuarantine: args.includeQuarantine ?? false,
			all: args.all ?? false
		}, { workspace: cwd });
		return {
			ok: result.kind === "success",
			message: result.text
		};
	}
});
const refCaptureTool = defineTool({
	name: "ref_capture",
	description: "Capture a bibliographic reference from the current conversation. Pass the fields you can ground in the conversation (title, authors, year, DOI, arXiv id, ISBN, LCCN, OCLC, Open Library ID, report number, container, pages); fields you omit are left for regex extraction. LCCN, OCLC and Open Library IDs are stored as identifiers only and are not verification evidence. With scope=\"turn\"|\"lastN\"|\"all\" the result is merged with every reference found in that conversation window. This tool only previews candidates; `/refs capture --save` or ref_save verifies and stores them.",
	parameters: {
		title: {
			type: "string",
			description: "Work title, in the language it appears in the conversation."
		},
		authors: {
			type: "array",
			items: { type: "string" },
			description: "Author names in citation order, e.g. [\"Zhang, S.\", \"Li, W.\"]."
		},
		year: {
			type: "integer",
			description: "Publication year (four digits)."
		},
		type: {
			type: "string",
			enum: [
				"journalArticle",
				"conferencePaper",
				"preprint",
				"report",
				"thesis",
				"book",
				"webpage"
			],
			description: "Reference type; defaults to journalArticle."
		},
		doi: {
			type: "string",
			description: "DOI without the https://doi.org/ prefix."
		},
		arxivId: {
			type: "string",
			description: "arXiv identifier, e.g. 2401.01234 or 2401.01234v2."
		},
		isbn: {
			type: "string",
			description: "ISBN for books. On its own it cannot be verified — supply a title so the registries can be searched."
		},
		lccn: {
			type: "string",
			description: "Library of Congress Control Number for a book; stored as an identifier, not verification evidence."
		},
		oclc: {
			type: "string",
			description: "WorldCat OCLC number for a book; stored as an identifier, not verification evidence."
		},
		openlibraryId: {
			type: "string",
			description: "Open Library book ID (e.g. OL123M); stored as an identifier, not verification evidence."
		},
		reportNumber: {
			type: "string",
			description: "Technical report number, e.g. NUREG/CR-1234, PB123456. On its own it cannot be verified — supply a title, or the DOI if the report has one."
		},
		url: {
			type: "string",
			description: "Landing page URL. A URL carrying a DOI or arXiv id is resolved from it; one that does not cannot be verified."
		},
		container: {
			type: "string",
			description: "Journal, conference, publisher or report series name."
		},
		volume: { type: "string" },
		issue: { type: "string" },
		pages: {
			type: "string",
			description: "Page range or article number, e.g. 45-67 or e12345."
		},
		scope: {
			type: "string",
			enum: [
				"turn",
				"lastN",
				"all"
			],
			description: "Also scan this conversation window with regex extraction and merge the results."
		},
		turns: {
			type: "integer",
			description: "N for scope=\"lastN\" (1..500, default 5)."
		},
		includeTools: {
			type: "boolean",
			description: "Include tool outputs in the scan. Default false because search results and plugin output are noisy."
		},
		evidence: {
			type: "array",
			items: { type: "integer" },
			description: "Session seq numbers where the reference appears, when known."
		}
	},
	output: {
		schema: captureSchema,
		render(_args, value) {
			const candidates = JSON.parse(value.candidatesJson);
			return [{
				type: "text",
				text: [
					`accepted: ${String(value.accepted)} · scope: ${value.scope} · read: ${value.readMode} · truncated: ${String(value.truncated)}`,
					`candidates: ${String(candidates.length)}`,
					value.candidatesJson,
					value.note
				].join("\n")
			}];
		}
	},
	async execute(args, exec) {
		const hasIdentity = (args.title ?? "") !== "" || (args.doi ?? "") !== "" || (args.arxivId ?? "") !== "" || (args.isbn ?? "") !== "" || (args.lccn ?? "") !== "" || (args.oclc ?? "") !== "" || (args.openlibraryId ?? "") !== "" || (args.reportNumber ?? "") !== "" || (args.url ?? "") !== "";
		if (!hasIdentity && args.scope === void 0) return {
			accepted: false,
			scope: "none",
			readMode: "none",
			turns: 0,
			messages: 0,
			chars: 0,
			truncated: false,
			candidatesJson: "[]",
			note: "Rejected: supply at least one of title, doi, arxivId, isbn, lccn, oclc, openlibraryId, reportNumber or url. isbn, reportNumber and url identify a work but cannot be looked up on their own — add a title, or a DOI where the work has one. lccn, oclc and openlibraryId are stored identifiers only, not verification evidence."
		};
		const modelInput = {
			title: args.title ?? "",
			authors: args.authors,
			year: args.year,
			type: args.type,
			doi: args.doi,
			arxivId: args.arxivId,
			isbn: args.isbn,
			lccn: args.lccn,
			oclc: args.oclc,
			openlibraryId: args.openlibraryId,
			reportNumber: args.reportNumber,
			url: args.url,
			container: args.container,
			volume: args.volume,
			issue: args.issue,
			pages: args.pages,
			evidence: args.evidence
		};
		const fromModel = hasIdentity ? candidateFromModel({
			...modelInput,
			evidence: sanitizeEvidence(modelInput.evidence ?? [], void 0)
		}) : void 0;
		const scopeArg = args.scope ?? "";
		const session = exec.agent?.session;
		if (scopeArg === "") return {
			accepted: true,
			scope: "model-only",
			readMode: "none",
			turns: 0,
			messages: 0,
			chars: 0,
			truncated: false,
			candidatesJson: JSON.stringify(fromModel === void 0 ? [] : [fromModel]),
			note: "Nothing persisted by this tool: it previews candidates. `/refs capture --save` verifies and stores them; entries that fail verification go to refs/quarantine.json."
		};
		if (session === void 0) return {
			accepted: true,
			scope: scopeArg,
			readMode: "none",
			turns: 0,
			messages: 0,
			chars: 0,
			truncated: false,
			candidatesJson: JSON.stringify(fromModel === void 0 ? [] : [fromModel]),
			note: "No live session is reachable from this tool, so scope scanning was skipped; only the model-supplied fields are reported."
		};
		const run = await collectCapture(session, scopeArg, args.turns === void 0 ? "" : String(args.turns), sessionQuery, outlineTurnStarts(session), args.includeTools ?? false);
		if ("error" in run) return {
			accepted: false,
			scope: scopeArg,
			readMode: "none",
			turns: 0,
			messages: 0,
			chars: 0,
			truncated: false,
			candidatesJson: JSON.stringify(fromModel === void 0 ? [] : [fromModel]),
			note: `Rejected: ${run.error}`
		};
		const window = new Set(run.read.segments.map((segment) => segment.seq));
		const groundedModel = hasIdentity ? candidateFromModel({
			...modelInput,
			evidence: sanitizeEvidence(modelInput.evidence ?? [], window)
		}) : void 0;
		const byKey = /* @__PURE__ */ new Map();
		const found = groundedModel === void 0 ? run.candidates : [...run.candidates, groundedModel];
		for (const candidate of found) {
			const existing = byKey.get(candidate.key);
			byKey.set(candidate.key, existing === void 0 ? candidate : mergeCandidates(existing, candidate));
		}
		const merged = rankCandidates([...byKey.values()]);
		return {
			accepted: true,
			scope: describeScope(run.scope),
			readMode: run.read.readMode,
			turns: run.read.resolution.turns,
			messages: run.read.segments.length,
			chars: run.read.chars,
			truncated: run.read.truncated,
			candidatesJson: JSON.stringify(merged),
			note: "Nothing persisted by this tool: candidate preview only. Model-supplied fields outrank regex guesses on merge; `/refs capture --save` stores the verified ones."
		};
	}
});
/**
* Host plugin. Registers the diagnostic tool, the capture tool, and the `/refs`
* command over one shared read/extract path.
*/
var src_default = {
	name: "refkeeper",
	apply(ctx) {
		ctx.inject(["tools"], (toolCtx) => {
			mount(toolCtx);
		});
	}
};
function mount(ctx) {
	ctx.inject(["sessionProjections"], (projectionCtx) => {
		projections = projectionCtx.sessionProjections;
	});
	ctx.inject(["sessionQuery"], (queryCtx) => {
		sessionQuery = queryCtx.sessionQuery;
	});
	const getOptionalService = ctx.get;
	serviceLookup = getOptionalService === void 0 ? void 0 : (name) => getOptionalService.call(ctx, name);
	try {
		directoryPickerController = getOptionalService?.call(ctx, "directoryPickerController");
	} catch {
		directoryPickerController = void 0;
	}
	try {
		hostFs = getOptionalService?.call(ctx, "fs");
	} catch {
		hostFs = void 0;
	}
	if (process.env["REFKEEPER_DEBUG"] !== void 0) console.error(`[refkeeper] mounted ${PACKAGE_NAME} (sdk ${probeSdkVersion() ?? "unknown"})`);
	ctx.effect(() => ctx.tools.register(refPingTool), "dsh-refkeeper: ref_ping tool");
	ctx.effect(() => ctx.tools.register(refCaptureTool), "dsh-refkeeper: ref_capture tool");
	ctx.effect(() => ctx.tools.register(refVerifyTool), "dsh-refkeeper: ref_verify tool");
	ctx.effect(() => ctx.tools.register(refSaveTool), "dsh-refkeeper: ref_save tool");
	ctx.effect(() => ctx.tools.register(refExportTool), "dsh-refkeeper: ref_export tool");
	ctx.inject(["commands"], (commandCtx) => {
		commandCtx.effect(() => commandCtx.commands.register({
			definitionId: CommandDefinitionId(`${PACKAGE_NAME}/refs`),
			name: "refs",
			description: "Capture, verify, store and export references for this workspace",
			input: { hint: "[status|capture|verify|save|list|export|dir|promote] …" },
			handler: async (invocation) => {
				const raw = invocation.rawInput.trim();
				if (raw === "verify" || raw.startsWith("verify ") || raw.startsWith("verify	")) return await runVerifyCommand(raw.slice(6), { verify: (claim) => verifyCandidate(claim, { cache: verifyCache }) });
				const session = invocation.agent.session;
				const cwd = workspaceOf(session);
				if (isStoreSubcommand(/^([a-z]+)/u.exec(raw)?.[1] ?? "")) {
					if (cwd === "") return {
						kind: "error",
						text: "no workspace: the session has no cwd."
					};
					return await runStoreCommand(raw, storeDeps(cwd, invocation.signal));
				}
				let batchPersistenceFailure;
				const result = await runRefsCommand(raw, session, {
					query: sessionQuery,
					sdkVersion: probeSdkVersion() ?? "unknown",
					turnStarts: outlineTurnStarts,
					save: async (candidates, context) => {
						const summary = await saveCaptured(candidates, {
							resolveIdentifier: async (candidate) => {
								const outcome = await verifyCandidate({
									doi: candidate.doi,
									arxivId: candidate.arxivId,
									...candidate.pmid === void 0 ? {} : { pmid: candidate.pmid },
									...candidate.pmcid === void 0 ? {} : { pmcid: candidate.pmcid },
									...candidate.reportNumber === void 0 ? {} : { reportNumber: candidate.reportNumber },
									...candidate.isbn === void 0 ? {} : { isbn: candidate.isbn },
									...candidate.url === void 0 ? {} : { url: candidate.url }
								}, { cache: verifyCache });
								return outcome.records.find((record) => record.source === outcome.report.matchedSource && record.title.trim() !== "") ?? outcome.records.find((record) => record.title.trim() !== "");
							},
							save: async (payload) => {
								const stored = await saveFromPayload(payload, storeDeps(cwd));
								return {
									kind: stored.kind,
									quarantined: stored.quarantined,
									id: stored.id,
									reason: stored.status,
									fields: fieldsOfReference(stored.reference)
								};
							}
						});
						if (summary.entries === void 0 || summary.entries.length === 0) return summary;
						const llm = optionalService("llm", llmService, (value) => {
							llmService = value;
						});
						const models = optionalService("agentDefaultModel", defaultModelService, (value) => {
							defaultModelService = value;
						});
						let annotated = {
							entries: [...summary.entries],
							outcome: void 0
						};
						try {
							annotated = await annotateCaptured(summary.entries, {
								workspace: cwd,
								...llm === void 0 ? {} : { llm },
								selection: () => routeOf(models?.currentSelection()),
								lines: context.lines
							});
						} catch {}
						const batch = {
							capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
							scope: scopeLabelOf(raw),
							entries: annotated.entries
						};
						let persisted = false;
						try {
							persisted = await writeBatch(cwd, batch);
						} catch (error) {
							batchPersistenceFailure = oneLineError(error);
						}
						const base = {
							...summary,
							entries: annotated.entries
						};
						const withBatch = persisted ? {
							...base,
							batch
						} : base;
						return annotated.outcome === void 0 ? withBatch : {
							...withBatch,
							annotations: annotated.outcome
						};
					}
				});
				if (batchPersistenceFailure === void 0) return result;
				return {
					...result,
					text: `${result.text}\nBatch persistence failed: ${batchPersistenceFailure}`
				};
			}
		}), "dsh-refkeeper: /refs command");
	});
}
export { SERVICE_KEY, src_default as default, probeSdkVersion, refCaptureTool, refExportTool, refPingTool, refSaveTool, refVerifyTool, verifyCache };
