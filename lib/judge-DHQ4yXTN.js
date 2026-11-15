// src/core/identifiers.ts
/** Hosts whose pages are almost always a citable work landing page. */
const STRONG_HOSTS = [
	"doi.org",
	"dx.doi.org",
	"arxiv.org",
	"pubmed.ncbi.nlm.nih.gov",
	"ncbi.nlm.nih.gov",
	"nature.com",
	"science.org",
	"cell.com",
	"sciencedirect.com",
	"link.springer.com",
	"springer.com",
	"wiley.com",
	"onlinelibrary.wiley.com",
	"tandfonline.com",
	"sagepub.com",
	"ieeexplore.ieee.org",
	"dl.acm.org",
	"aclanthology.org",
	"cnki.net",
	"kns.cnki.net",
	"wanfangdata.com.cn",
	"cqvip.com",
	"jstor.org",
	"ncbi.nlm.nih.gov",
	"europepmc.org",
	"openalex.org",
	"semanticscholar.org"
];
/** Host suffix match, so `www.nature.com` and `nature.com` both count. */
function hostIsStrong(host) {
	return STRONG_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}
/** Strip punctuation that prose glues onto a trailing identifier. */
function trimTrailing(raw) {
	let value = raw;
	for (;;) {
		const last = value.at(-1);
		if (last === void 0) return value;
		if (".,;:'\"”’、，。；：".includes(last)) {
			value = value.slice(0, -1);
			continue;
		}
		if (last === ")" && (value.match(/\(/gu)?.length ?? 0) < (value.match(/\)/gu)?.length ?? 0)) {
			value = value.slice(0, -1);
			continue;
		}
		if (last === ">" && (value.match(/</gu)?.length ?? 0) < (value.match(/>/gu)?.length ?? 0)) {
			value = value.slice(0, -1);
			continue;
		}
		return value;
	}
}
const DOI = /\b10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/giu;
const ARXIV_BARE = /\barxiv\s*:\s*(\d{4}\.\d{4,5})(?:v\d+)?/giu;
const ARXIV_OLD_ID = `(?:astro-ph|cond-mat|cs|econ|gr-qc|hep-ex|hep-lat|hep-ph|hep-th|math-ph|math|nlin|nucl-ex|nucl-th|physics|q-bio|q-fin|stat)(?:\\.[a-z0-9-]+)?/\\d{7,8}`;
const ARXIV_OLD = new RegExp(`(?<![/\\w])(?:arxiv\\s*:\\s*)?(${ARXIV_OLD_ID})(?:v\\d+)?\\b`, "giu");
const ARXIV_URL_SOURCE = `\\barxiv\\.org\\/(?:abs|pdf|format)\\/((?:\\d{4}\\.\\d{4,5})|${ARXIV_OLD_ID})(?:v\\d+)?`;
const ARXIV_URL = new RegExp(ARXIV_URL_SOURCE, "giu");
const ARXIV_URL_IN_URL = new RegExp(ARXIV_URL_SOURCE, "iu");
/** PMID and PMCID identifiers must be explicitly labeled to avoid numeric false positives. */
const PMID = /\bPMID[:\s]\s*(\d{6,8})\b/giu;
const PMCID = /\bPMCID[:\s]\s*(PMC\d+)\b/giu;
const ISBN13 = /\b(97[89][\d\-\s]{8,16}[\dXx])\b/gu;
/**
* Bare ISBN-10 only counts when the text labels it: the shape test alone
* accepts any 10-digit number, and the checksum only rejects 10 in 11.
*/
const ISBN10 = /\bISBN(?:-1[03])?\s*[:：]?\s*(\d[\d\-\s]{7,12}[\dXx])\b/giu;
const REPORT = /\b(PB\d{6,}|NUREG-\d{3,}|WHO\/[A-Z]{2,}\/\d{1,4}|GB\/T\s?\d{1,6}(?:[-.]\d{1,4})?|ISO\s?\d{1,6}(?:[-:]\d{1,4})?)\b/gu;
/** New report families are case-insensitive but retain the matched spelling. */
const ADDITIONAL_REPORT = /\b(?:RFC-\d{1,5}|DOE\/[A-Z]{2,}-?\d{3,}|NASA\/[A-Z]{2,}-?\d{3,}(?:-\d{3,})?|NTRS[ -]?\d{6,}|NACA[ -]?\d{4,6}|AD-?A\d{6,}|EPA-?\d{3}-[A-Z]-\d{3}|EPA-?\d{3}\/[A-Z]-\d{2}\/\d{3})\b/giu;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'”）】\]]+/giu;
/** Bare-DOI normal form: lowercase (DOIs are case-insensitive) and trimmed. */
function normalizeDoi(raw) {
	return trimTrailing(raw).trim().toLowerCase();
}
/** arXiv ids are compared without the version suffix. */
function normalizeArxiv(raw) {
	return raw.replace(/v\d+$/u, "");
}
/** ISBN comparison form: digits and X only. */
function normalizeIsbn(raw) {
	return raw.replace(/[^\dXx]/gu, "").toUpperCase();
}
/**
* ISBN-13 check digit, alternating 1/3 weights over the first twelve digits.
*
* Validation is the only cheap way to tell an ISBN from any 13-digit number
* (order ids, timestamps), and a mistyped ISBN is a bad row rather than a
* missed one — so a failed checksum drops the hit.
*/
function isValidIsbn13(value) {
	if (!/^\d{13}$/u.test(value)) return false;
	let sum = 0;
	for (const [index, char] of value.split("").entries()) sum += Number(char) * (index % 2 === 0 ? 1 : 3);
	return sum % 10 === 0;
}
/** ISBN-10 check digit: weights 10..1, `X` counts as 10. */
function isValidIsbn10(value) {
	if (!/^\d{9}[\dX]$/u.test(value)) return false;
	let sum = 0;
	for (const [index, char] of value.split("").entries()) sum += (char === "X" ? 10 : Number(char)) * (10 - index);
	return sum % 11 === 0;
}
function push(hits, seen, hit) {
	const key = `${hit.kind}:${hit.value}`;
	if (seen.has(key)) return;
	seen.add(key);
	hits.push(hit);
}
/**
* Extract every identifier occurrence in one text block.
*
* Ordering is by kind priority (doi, arxiv, pmid, pmcid, isbn, report, url)
* rather than by position, because later stages want "what did we pin down"
* first and "what might be interesting" last.
*/
function extractIdentifiers(text) {
	const hits = [];
	const seen = /* @__PURE__ */ new Set();
	for (const match of text.matchAll(URL_PATTERN)) {
		const raw = trimTrailing(match[0]);
		let host = "";
		try {
			host = new URL(raw).hostname.toLowerCase();
		} catch {
			continue;
		}
		const doiInUrl = raw.match(/10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/iu);
		if (doiInUrl !== null) {
			push(hits, seen, {
				kind: "doi",
				value: normalizeDoi(doiInUrl[0]),
				raw,
				host,
				confidence: .95
			});
			continue;
		}
		const arxivInUrl = ARXIV_URL_IN_URL.exec(raw);
		if (arxivInUrl?.[1] !== void 0) {
			push(hits, seen, {
				kind: "arxiv",
				value: normalizeArxiv(arxivInUrl[1]),
				raw,
				host,
				confidence: .95
			});
			continue;
		}
		push(hits, seen, {
			kind: "url",
			value: raw,
			raw,
			host,
			confidence: hostIsStrong(host) ? .7 : .3
		});
	}
	for (const match of text.matchAll(DOI)) push(hits, seen, {
		kind: "doi",
		value: normalizeDoi(match[0]),
		raw: match[0],
		host: "",
		confidence: .95
	});
	for (const match of text.matchAll(ARXIV_BARE)) {
		const id = match[1];
		if (id === void 0) continue;
		push(hits, seen, {
			kind: "arxiv",
			value: normalizeArxiv(id),
			raw: match[0],
			host: "",
			confidence: .92
		});
	}
	for (const match of text.matchAll(ARXIV_OLD)) {
		const id = match[1];
		if (id === void 0) continue;
		push(hits, seen, {
			kind: "arxiv",
			value: normalizeArxiv(id),
			raw: match[0],
			host: "",
			confidence: .92
		});
	}
	for (const match of text.matchAll(ARXIV_URL)) {
		const id = match[1];
		if (id === void 0) continue;
		push(hits, seen, {
			kind: "arxiv",
			value: normalizeArxiv(id),
			raw: match[0],
			host: "arxiv.org",
			confidence: .92
		});
	}
	for (const match of text.matchAll(PMID)) {
		const value = match[1];
		if (value === void 0) continue;
		push(hits, seen, {
			kind: "pmid",
			value,
			raw: match[0],
			host: "",
			confidence: .98
		});
	}
	for (const match of text.matchAll(PMCID)) {
		const value = match[1];
		if (value === void 0) continue;
		push(hits, seen, {
			kind: "pmcid",
			value: value.toUpperCase(),
			raw: match[0],
			host: "",
			confidence: .98
		});
	}
	for (const match of text.matchAll(ISBN13)) {
		const value = normalizeIsbn(match[1] ?? "");
		if (!isValidIsbn13(value)) continue;
		push(hits, seen, {
			kind: "isbn",
			value,
			raw: match[0],
			host: "",
			confidence: .85
		});
	}
	for (const match of text.matchAll(ISBN10)) {
		const value = normalizeIsbn(match[1] ?? "");
		if (!isValidIsbn10(value)) continue;
		push(hits, seen, {
			kind: "isbn",
			value,
			raw: match[1] ?? match[0],
			host: "",
			confidence: .8
		});
	}
	const reportMatches = [...Array.from(text.matchAll(REPORT), (match) => ({
		index: match.index ?? -1,
		value: collapseReport(match[1] ?? ""),
		raw: match[0],
		confidence: confidenceForReport(match[0])
	})), ...Array.from(text.matchAll(ADDITIONAL_REPORT), (match) => ({
		index: match.index ?? -1,
		value: collapseReport(match[0]),
		raw: match[0],
		confidence: confidenceForReport(match[0])
	}))].sort((left, right) => left.index - right.index);
	for (const match of reportMatches) push(hits, seen, {
		kind: "report",
		value: match.value,
		raw: match.raw,
		host: "",
		confidence: match.confidence
	});
	return hits;
}
function confidenceForReport(raw) {
	return /^(?:GB\/T|ISO)/iu.test(raw) ? .4 : .8;
}
/** Report numbers vary by spacing/case; comparing a compact form avoids misses. */
function collapseReport(raw) {
	return raw.replace(/\s+/gu, "").toUpperCase();
}
// src/core/text.ts
/**
* Text normalization shared by extraction, dedupe and (later) verification.
*
* Every comparison in this plugin — is this the same paper, is this title the
* same as the source's — goes through these helpers, so the rules live in one
* place instead of being re-guessed per call site.
*/
/** Collapse every whitespace run (including full-width spaces) to one space. */
function collapseSpace(input) {
	return input.replace(/[\s\u3000]+/gu, " ").trim();
}
/** NFKC + lowercase + collapsed spaces: the comparison form for Latin text. */
function foldText(input) {
	return collapseSpace(input.normalize("NFKC")).toLowerCase();
}
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
/** True when the string carries CJK characters (switches the similarity metric). */
function hasCjk(input) {
	return CJK.test(input);
}
/**
* Dedupe key for titles: letters and digits only.
*
* Punctuation differs wildly between a chat message and a registry record
* ("Attention Is All You Need" vs "Attention is all you need."), so the key
* drops everything else rather than trying to normalize punctuation.
*/
function titleKey(input) {
	return foldText(input).replace(/[^\p{L}\p{N}]+/gu, "");
}
/** Token set for Jaccard similarity; single characters are dropped. */
function titleTokens(input) {
	const tokens = foldText(input).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);
	return new Set(tokens);
}
/**
* Token Jaccard similarity in `[0, 1]`.
*
* Used for Latin titles; returns 0 when either side has no tokens so callers
* never treat "nothing to compare" as a match.
*/
function jaccard(a, b) {
	const left = titleTokens(a);
	const right = titleTokens(b);
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / (left.size + right.size - shared);
}
/** Character bigrams, ignoring spaces; CJK titles have no word boundaries. */
function bigrams(input) {
	const compact = foldText(input).replace(/[\s\u3000]+/gu, "");
	const grams = /* @__PURE__ */ new Set();
	for (let i = 0; i + 1 < compact.length; i += 1) grams.add(compact.slice(i, i + 2));
	return grams;
}
/** Sørensen–Dice on character bigrams, the CJK title metric. */
function diceBigrams(a, b) {
	const left = bigrams(a);
	const right = bigrams(b);
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const gram of left) if (right.has(gram)) shared += 1;
	return 2 * shared / (left.size + right.size);
}
/**
* Strip Markdown decoration that chat text carries but a reference field must
* not: blockquote markers (`> Daly, C.`), list bullets, emphasis asterisks
* (`*International Journal of Climatology*`), backticks and scriptio continua
* underscores. A model answer renders a citation line as a quotation, so this
* runs before parsing rather than after — otherwise the marker becomes part of
* the stored author or journal name.
*/
function stripMarkup(input) {
	return collapseSpace(input.replace(/^(?:[ \t]*>)+[ \t]*/gmu, "").replace(/^[ \t]*[•·][ \t]*/gmu, "").replace(/^[ \t]*[-+][ \t]+/gmu, "").replace(/[*`]+/gu, "").replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, "$1")).replace(/^[\s>•*]+/u, "").replace(/[\s*]+$/u, "");
}
/**
* Normalize a personal author name to family-first form while preserving
* already-comma-separated names. Corporate names must be recognized by the
* caller before using this helper.
*/
function formatAuthorName(input) {
	const cleaned = collapseSpace(input);
	if (cleaned === "" || cleaned.includes(",")) return cleaned;
	const words = cleaned.split(" ");
	if (words.length < 2) return cleaned;
	return `${words.pop() ?? ""}, ${words.join(" ")}`;
}
/** Truncate to `limit` characters, appending `…` when it actually cut. */
function clip(input, limit) {
	return input.length <= limit ? input : `${input.slice(0, Math.max(0, limit - 1))}…`;
}
// src/core/citations.ts
/**
* Pass 2 extraction: reference strings that are already formatted as citations.
*
* Three styles cover the material this plugin meets in practice: GB/T 7714
* (Chinese journals), APA and IEEE (English journals). The parser is
* deliberately shallow — it fills title/year/authors/container and leaves the
* authoritative fields to the identifier pass or the model (Pass 3). A citation
* string that misses a year or a plausible title is dropped rather than stored
* half-parsed, because a wrong year is worse than no entry.
*/
/** GB/T 7714 type codes on the `[J]` marker. */
const GBT_TYPE = {
	J: "journalArticle",
	C: "conferencePaper",
	M: "book",
	D: "thesis",
	R: "report",
	"EB/OL": "webpage",
	"J/OL": "journalArticle",
	"M/OL": "book",
	"C/OL": "conferencePaper"
};
/**
* A journal name left with a dangling separator (`International Journal of
* Climatology,`) or emphasis residue is not the journal name.
*/
function cleanContainer(raw) {
	return stripMarkup(raw).replace(/^[\s,.;:，。；：]+/u, "").replace(/[\s,;:，。；：]+$/u, "").replace(/^[([（【]+/u, "").replace(/[)\]）】]+$/u, "");
}
function plausibleYear(raw) {
	if (raw === void 0) return void 0;
	const year = Number.parseInt(raw, 10);
	if (!Number.isFinite(year) || year < 1800 || year > 2100) return void 0;
	return year;
}
/**
* A title is plausible when it is long enough to be a title rather than a label.
* CJK titles pack the same information into far fewer characters, so the floor
* is 4 rather than 6 there: "数据结构" is a real book, "Data" is not a title.
*/
function plausibleTitle(title) {
	const trimmed = title.trim();
	return hasCjk(trimmed) ? trimmed.length >= 4 : trimmed.length >= 6;
}
/** "S.", "S. A.", "J.-P." — an initials fragment, never a surname on its own. */
const INITIALS_ONLY = /^(?:[A-Z]\.\s*-?\s*)+$/u;
/**
* Split an author list without tearing "Surname, I. I." in half.
*
* APA and GB/T both write `Surname, I. I.` inside a comma-separated list, so a
* naive split on `,` yields `['Zhang', 'S.', 'Li', 'W.']` — four people where
* there are two, which then makes "first author" comparison compare a surname
* against an initial. Comma-separated fragments that are only initials are
* folded back into the surname they belong to. `&`/`and`/`;` stay hard
* separators because they never appear inside one name.
*/
function splitAuthors(raw) {
	const parts = raw.replace(/\s*(?:&|\band\b)\s*/gu, ",").split(/[,，;；、]/u).map((part) => stripMarkup(part)).filter((part) => part !== "");
	const authors = [];
	for (const part of parts) {
		const previous = authors.at(-1);
		if (previous !== void 0 && INITIALS_ONLY.test(part)) {
			authors[authors.length - 1] = `${previous}, ${part}`;
			continue;
		}
		authors.push(part);
	}
	return authors.filter((author) => author.length < 80).slice(0, 50);
}
/** Grab volume/issue/pages out of a `, 47(3): 1-15` style tail. */
function parseVolumeIssuePages(tail) {
	const volumeIssue = tail.match(/(\d{1,5})\s*[（(]\s*(\d{1,4})\s*[)）]/u);
	const pages = tail.match(/(?:[:：]\s*|pp?\.?\s*|,\s*)([A-Za-z]?\d{1,6}\s*[-–—~]\s*[A-Za-z]?\d{1,6})/u);
	return {
		volume: volumeIssue?.[1] ?? "",
		issue: volumeIssue?.[2] ?? "",
		pages: pages?.[1]?.replace(/\s+/gu, "") ?? ""
	};
}
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[-._;()/:a-z0-9<>]+/iu;
/** GB/T 7714: `作者. 标题[J]. 刊名, 2024, 47(3): 1-15.` */
function parseGbt7714(line) {
	const match = line.match(/^(.{2,300}?)[.．]\s*(.{4,300}?)\s*\[([A-Z]{1,2}(?:\/OL)?)\]\s*[.．]?\s*(.*)$/u);
	if (match === null) return void 0;
	const typeCode = match[3] ?? "";
	const type = GBT_TYPE[typeCode];
	if (type === void 0) return void 0;
	const title = stripMarkup(match[2] ?? "");
	if (!plausibleTitle(title)) return void 0;
	const tail = stripMarkup(match[4] ?? "");
	const year = plausibleYear(tail.match(/\b(1[89]\d{2}|20\d{2})\b/u)?.[1]);
	if (year === void 0) return void 0;
	const container = cleanContainer(tail.split(/[,，]/u)[0] ?? "");
	return {
		style: "gbt7714",
		type,
		title,
		authors: splitAuthors(match[1] ?? ""),
		year,
		container,
		...parseVolumeIssuePages(tail),
		doi: normalizeDoiIn(tail),
		raw: line,
		confidence: .55
	};
}
const APA = /^(.{2,200}?)\(\s*(1[89]\d{2}|20\d{2})\s*\)\s*[.．]\s*(.{4,300}?)[.．]\s*(.*)$/u;
/** Drop prose that introduces the citation (`Please cite: Wells, N., …`). */
function trimLeadIn(block) {
	const at = Math.max(block.lastIndexOf(":"), block.lastIndexOf("："));
	if (at < 0) return block;
	const tail = block.slice(at + 1).trim();
	return tail === "" ? block : tail;
}
/** APA: `Author, A. A. (2024). Title. Journal, 12(3), 45–67.` */
function parseApa(line) {
	const match = line.match(APA);
	if (match === null) return void 0;
	const title = stripMarkup(match[3] ?? "");
	if (!plausibleTitle(title)) return void 0;
	const tail = stripMarkup(match[4] ?? "");
	return {
		style: "apa",
		type: "journalArticle",
		title,
		authors: splitAuthors(trimLeadIn(match[1] ?? "")),
		year: plausibleYear(match[2]),
		container: cleanContainer(tail.split(/[,，.]/u)[0] ?? ""),
		...parseVolumeIssuePages(tail),
		doi: normalizeDoiIn(line),
		raw: line,
		confidence: .5
	};
}
const CONFERENCE_HINT = /\b(proc\.?|proceedings|conference|symposium|workshop|congress)\b/iu;
const IEEE = /^\[\d{1,3}\]\s*(.{2,200}?)\s*["“”](.{4,300}?)["“”]\s*[,，]?\s*(.*)$/u;
/** IEEE: `[1] A. Author, "Title," Journal, vol. 12, no. 3, pp. 45–67, 2024.` */
function parseIeee(line) {
	const match = line.match(IEEE);
	if (match === null) return void 0;
	const title = stripMarkup(match[2] ?? "").replace(/[,，.．]\s*$/u, "");
	if (!plausibleTitle(title)) return void 0;
	const tail = stripMarkup(match[3] ?? "");
	const year = plausibleYear(tail.match(/\b(1[89]\d{2}|20\d{2})\b/u)?.[1]);
	if (year === void 0) return void 0;
	const volume = tail.match(/vol\.?\s*(\d{1,5})/iu)?.[1] ?? "";
	const issue = tail.match(/no\.?\s*(\d{1,4})/iu)?.[1] ?? "";
	const pages = tail.match(/pp\.?\s*([A-Za-z]?\d{1,6}\s*[-–—~]\s*[A-Za-z]?\d{1,6})/iu)?.[1] ?? "";
	return {
		style: "ieee",
		type: CONFERENCE_HINT.test(tail) ? "conferencePaper" : "journalArticle",
		title,
		authors: splitAuthors(match[1] ?? ""),
		year,
		container: cleanContainer(tail.split(/[,，]/u)[0] ?? ""),
		volume,
		issue,
		pages: pages.replace(/\s+/gu, ""),
		doi: normalizeDoiIn(line),
		raw: line,
		confidence: .6
	};
}
const VANCOUVER = /^(?:[1-9]|1[0-9]|2[0-5])\.\s*(.{2,500}?)\.\s*(.{6,300}?)\.\s*(.{2,200}?)\.\s*(1[89]\d{2}|20\d{2})(?:\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?\s*;\s*(.*)$/iu;
/** Convert Vancouver surname-first names without changing legacy author parsing. */
function splitVancouverAuthors(raw) {
	return raw.split(/[,，]/u).map((part) => stripMarkup(part).trim()).filter((author) => author !== "").map((author) => {
		const match = author.match(/^(.*?)\s+([A-Z](?:[A-Z.-]{0,4}))$/u);
		if (match === null) return author;
		const surname = match[1]?.trim() ?? "";
		const initials = match[2]?.replace(/[^A-Z]/gu, "") ?? "";
		return surname !== "" && initials.length > 0 && initials.length <= 3 ? `${surname}, ${initials}` : author;
	}).slice(0, 50);
}
/** Numbered Vancouver: `1. Author J. Title. Journal. 2024 Mar;47(3):1-15.` */
function parseVancouver(line) {
	const match = line.match(VANCOUVER);
	if (match === null) return void 0;
	const title = stripMarkup(match[2] ?? "");
	if (!plausibleTitle(title)) return void 0;
	const year = plausibleYear(match[4]);
	if (year === void 0) return void 0;
	const tail = stripMarkup(match[6] ?? "");
	const parsed = parseVolumeIssuePages(tail);
	const pagination = tail.match(/^\s*(\d{1,5})(?:\s*[（(]\s*(\d{1,4})\s*[)）])?\s*[:：]\s*(e?\d{1,6}(?:\s*[-–—~]\s*e?\d{1,6})?)/iu);
	return {
		style: "vancouver",
		type: "journalArticle",
		title,
		authors: splitVancouverAuthors(match[1] ?? ""),
		year,
		container: cleanContainer(match[3] ?? ""),
		volume: parsed.volume || pagination?.[1] || "",
		issue: parsed.issue || pagination?.[2] || "",
		pages: parsed.pages || pagination?.[3]?.replace(/\s+/gu, "") || "",
		doi: normalizeDoiIn(line),
		raw: line,
		confidence: .5
	};
}
function normalizeDoiIn(text) {
	const match = text.match(DOI_IN_TEXT);
	return match === null ? "" : normalizeDoi(match[0]);
}
/** Lines longer than this are prose that happens to contain brackets. */
const MAX_LINE = 600;
/**
* Parse reference strings out of a text block, one per line.
*
* Only lines that parse end-to-end become hits: a partial match is exactly the
* failure mode that produces plausible-looking wrong entries.
*/
/**
* Citation strings wrap: a chat bubble or a PDF copy puts the year on one line
* and the page range on the next. `^...$` parsers then miss every wrapped
* reference, so each line is also tried glued to its successor when the first
* line clearly continues (no terminal punctuation, or the next line opens with
* a URL, a digit or a lowercase word).
*/
function candidateLines(text) {
	const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line !== "");
	const out = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		out.push(line);
		const next = lines[index + 1];
		if (next === void 0) continue;
		if (!(!/[.。!?！？;；]$/u.test(line) || /^(https?:\/\/|\d|\(|\[|[a-z])/u.test(next))) continue;
		const glued = `${line} ${next}`;
		if (glued.length <= MAX_LINE) out.push(glued);
	}
	return out;
}
/** How much a parse actually filled in; used to prefer the richer duplicate. */
function scoreHit(hit) {
	let score = 0;
	if (hit.doi !== "") score += 4;
	if (hit.pages !== "") score += 2;
	if (hit.volume !== "") score += 1;
	if (hit.issue !== "") score += 1;
	if (hit.authors.length > 0) score += 1;
	return score;
}
var BibtexParseError = class extends Error {};
/** Find complete @records without being confused by nested braces or quotes. */
function scanBibtexBlocks(text) {
	const matcher = /@([a-z][a-z0-9_-]*)\s*([({])/giu;
	const blocks = [];
	let match = matcher.exec(text);
	while (match !== null) {
		const start = match.index;
		const type = (match[1] ?? "").toLowerCase();
		const opening = match[2] ?? "";
		let braceDepth = opening === "{" ? 1 : 0;
		let parenDepth = opening === "(" ? 1 : 0;
		let quoted = false;
		let escaped = false;
		let end = -1;
		for (let index = matcher.lastIndex; index < text.length; index += 1) {
			const character = text[index] ?? "";
			if (quoted) {
				if (escaped) escaped = false;
				else if (character.charCodeAt(0) === 92) escaped = true;
				else if (character === "\"") quoted = false;
				continue;
			}
			if (character === "\"" && (opening === "{" ? braceDepth === 1 : braceDepth === 0)) {
				quoted = true;
				continue;
			}
			if (character === "{") {
				braceDepth += 1;
				continue;
			}
			if (character === "}" && braceDepth > 0) {
				braceDepth -= 1;
				if (opening === "{" && braceDepth === 0) {
					end = index + 1;
					break;
				}
				continue;
			}
			if (opening === "(" && braceDepth === 0) {
				if (character === "(") parenDepth += 1;
				else if (character === ")") {
					parenDepth -= 1;
					if (parenDepth === 0) {
						end = index + 1;
						break;
					}
				}
			}
		}
		if (end < 0) {
			matcher.lastIndex = start + 1;
			match = matcher.exec(text);
			continue;
		}
		const raw = text.slice(start, end).trim();
		const bodyStart = matcher.lastIndex;
		const bodyEnd = end - 1;
		blocks.push({
			start,
			end,
			type,
			raw,
			body: text.slice(bodyStart, bodyEnd).trim()
		});
		matcher.lastIndex = end;
		match = matcher.exec(text);
	}
	return blocks;
}
function splitBibtexTopLevel(value, delimiter) {
	const parts = [];
	let start = 0;
	let braceDepth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index] ?? "";
		if (quoted) {
			if (escaped) escaped = false;
			else if (character.charCodeAt(0) === 92) escaped = true;
			else if (character === "\"") quoted = false;
			continue;
		}
		if (character === "\"" && braceDepth === 0) {
			quoted = true;
			continue;
		}
		if (character === "{") braceDepth += 1;
		else if (character === "}" && braceDepth > 0) braceDepth -= 1;
		else if (character === delimiter && braceDepth === 0) {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(value.slice(start));
	return parts;
}
function topLevelIndex(value, delimiter) {
	let braceDepth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index] ?? "";
		if (quoted) {
			if (escaped) escaped = false;
			else if (character.charCodeAt(0) === 92) escaped = true;
			else if (character === "\"") quoted = false;
			continue;
		}
		if (character === "\"" && braceDepth === 0) {
			quoted = true;
			continue;
		}
		if (character === "{") braceDepth += 1;
		else if (character === "}" && braceDepth > 0) braceDepth -= 1;
		else if (character === delimiter && braceDepth === 0) return index;
	}
	return -1;
}
function parseBibtexFields(block, includeFirstAssignment) {
	const parts = splitBibtexTopLevel(block.body, ",");
	const fields = /* @__PURE__ */ new Map();
	for (const part of parts.slice(includeFirstAssignment ? 0 : 1)) {
		const trimmed = part.trim();
		if (trimmed === "") continue;
		const equals = topLevelIndex(trimmed, "=");
		if (equals < 0) {
			if (includeFirstAssignment) throw new BibtexParseError(`Invalid @string definition: ${trimmed}`);
			continue;
		}
		const name = trimmed.slice(0, equals).trim().toLowerCase();
		if (!/^[a-z][a-z0-9_-]*$/u.test(name)) throw new BibtexParseError(`Invalid BibTeX field name: ${name || trimmed}`);
		fields.set(name, trimmed.slice(equals + 1).trim());
	}
	return fields;
}
function isWrappedByBraces(value) {
	if (!value.startsWith("{") || !value.endsWith("}")) return false;
	let depth = 0;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index] ?? "";
		if (character === "{") depth += 1;
		else if (character === "}") depth -= 1;
		if (depth === 0 && index < value.length - 1) return false;
		if (depth < 0) return false;
	}
	return depth === 0;
}
function cleanBibtexText(value) {
	return value.replace(/\\([{}#%&_$])/gu, "$1").replace(/\\(["\\])/gu, "$1").replace(/[{}]/gu, "").replace(/\s+/gu, " ").trim();
}
function cleanBibtexLiteral(value) {
	const cleaned = cleanBibtexText(value);
	if (cleaned === "") return "";
	return `${/^\s/u.test(value) ? " " : ""}${cleaned}${/\s$/u.test(value) ? " " : ""}`;
}
function cleanBibtexAuthorText(value) {
	return value.replace(/\s+/gu, " ").trim();
}
function expandBibtexValue(expression, macros, field, stack = [], preserveAuthorBraces = false) {
	return splitBibtexTopLevel(expression, "#").map((part) => {
		const value = part.trim();
		if (value === "") return "";
		if (isWrappedByBraces(value)) {
			const inner = value.slice(1, -1);
			return preserveAuthorBraces ? cleanBibtexAuthorText(inner) : cleanBibtexLiteral(inner);
		}
		if (value.startsWith("\"") && value.endsWith("\"")) {
			const inner = value.slice(1, -1);
			return preserveAuthorBraces ? cleanBibtexAuthorText(inner) : cleanBibtexLiteral(inner);
		}
		if (/^\d+$/u.test(value) || /^\d+[a-z0-9./:+_-]*$/iu.test(value)) return value;
		if (/^[a-z][a-z0-9_-]*$/iu.test(value)) {
			const macro = value.toLowerCase();
			const expansion = macros.get(macro);
			if (expansion === void 0) throw new BibtexParseError(`Unexpandable BibTeX macro "${value}" in field "${field}"`);
			if (stack.includes(macro)) throw new BibtexParseError(`Cyclic BibTeX macro "${value}" in field "${field}"`);
			return expandBibtexValue(expansion, macros, field, [...stack, macro], preserveAuthorBraces);
		}
		if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/iu.test(value)) return value;
		throw new BibtexParseError(`Unexpandable BibTeX value "${value}" in field "${field}"`);
	}).join("");
}
function splitBibtexAuthors(raw) {
	const names = [];
	let start = 0;
	let braceDepth = 0;
	for (let index = 0; index < raw.length; index += 1) {
		const character = raw[index] ?? "";
		if (character === "{") braceDepth += 1;
		else if (character === "}" && braceDepth > 0) braceDepth -= 1;
		if (braceDepth !== 0) continue;
		const separator = raw.slice(index).match(/^\s+and\s+/iu)?.[0];
		if (separator === void 0) continue;
		names.push(raw.slice(start, index).trim());
		index += separator.length - 1;
		start = index + 1;
	}
	names.push(raw.slice(start).trim());
	return names.filter((name) => name !== "").map((name) => {
		const corporate = isWrappedByBraces(name);
		const cleaned = cleanBibtexText(name);
		if (corporate) return cleaned;
		return formatAuthorName(cleaned);
	});
}
const BIBTEX_TYPES = {
	article: "journalArticle",
	inproceedings: "conferencePaper",
	conference: "conferencePaper",
	book: "book",
	inbook: "book",
	incollection: "book",
	techreport: "report",
	report: "report",
	unpublished: "report",
	phdthesis: "thesis",
	mastersthesis: "thesis",
	misc: "webpage"
};
const BIBTEX_MONTHS = {
	jan: "{January}",
	feb: "{February}",
	mar: "{March}",
	apr: "{April}",
	may: "{May}",
	jun: "{June}",
	jul: "{July}",
	aug: "{August}",
	sep: "{September}",
	oct: "{October}",
	nov: "{November}",
	dec: "{December}"
};
function normalizeBibtexDoi(value) {
	const normalizedValue = value.trim();
	const lowercase = normalizedValue.toLowerCase();
	const prefix = [
		"https://doi.org/",
		"http://doi.org/",
		"https://dx.doi.org/",
		"http://dx.doi.org/"
	].find((candidate) => lowercase.startsWith(candidate));
	return normalizeDoi(prefix === void 0 ? normalizedValue : normalizedValue.slice(prefix.length));
}
function parseBibtexRecord(block, macros) {
	if (block.type === "comment" || block.type === "string" || block.type === "preamble") return void 0;
	const rawFields = parseBibtexFields(block, false);
	const fields = /* @__PURE__ */ new Map();
	for (const [name, expression] of rawFields) {
		const preserveAuthorBraces = name === "author";
		const expanded = expandBibtexValue(expression, macros, name, [], preserveAuthorBraces);
		fields.set(name, preserveAuthorBraces ? expanded.trim() : cleanBibtexText(expanded));
	}
	const title = fields.get("title") ?? "";
	if (title === "") return void 0;
	const yearMatch = (fields.get("year") ?? "").match(/^((?:18|19|20|21)\d{2})(?:-(?:0[1-9]|1[0-2])|\/(?:0[1-9]|1[0-2]))?$/u);
	const year = yearMatch === null ? void 0 : plausibleYear(yearMatch[1]);
	const doiText = fields.get("doi") ?? "";
	return {
		style: "bibtex",
		type: BIBTEX_TYPES[block.type] ?? "webpage",
		title,
		authors: splitBibtexAuthors(fields.get("author") ?? ""),
		year,
		container: fields.get("journal") ?? fields.get("booktitle") ?? "",
		volume: fields.get("volume") ?? "",
		issue: fields.get("number") ?? "",
		pages: fields.get("pages") ?? "",
		doi: doiText === "" ? "" : normalizeBibtexDoi(doiText),
		raw: block.raw,
		confidence: .9
	};
}
function reportBibtexFailure(error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn("[refkeeper] BibTeX parse failed:", message);
}
function bibtexMacros(blocks) {
	const macros = new Map(Object.entries(BIBTEX_MONTHS));
	for (const block of blocks) {
		if (block.type !== "string") continue;
		try {
			for (const [name, expression] of parseBibtexFields(block, true)) macros.set(name, expression);
		} catch (error) {
			reportBibtexFailure(error);
		}
	}
	return macros;
}
function parseBibtexRecords(blocks) {
	const macros = bibtexMacros(blocks);
	const hits = [];
	for (const block of blocks) try {
		const hit = parseBibtexRecord(block, macros);
		if (hit !== void 0) hits.push(hit);
	} catch (error) {
		reportBibtexFailure(error);
	}
	return hits;
}
/** Parse BibTeX records in a text block, expanding @string definitions first. */
function parseBibtexBlocks(text) {
	return parseBibtexRecords(scanBibtexBlocks(text));
}
/** Parse one BibTeX record; throws when a referenced macro cannot be expanded. */
function parseBibtexBlock(block, macros = /* @__PURE__ */ new Map()) {
	const located = scanBibtexBlocks(block)[0];
	return located === void 0 ? void 0 : parseBibtexRecord(located, macros);
}
function removeBibtexBlocks(text, blocks) {
	if (blocks.length === 0) return text;
	const remaining = [];
	let cursor = 0;
	for (const block of blocks) {
		remaining.push(text.slice(cursor, block.start));
		cursor = block.end;
	}
	remaining.push(text.slice(cursor));
	return remaining.join("\n");
}
function extractCitations(text) {
	const blocks = scanBibtexBlocks(text);
	const hits = parseBibtexRecords(blocks);
	const seen = /* @__PURE__ */ new Set();
	for (const line of candidateLines(removeBibtexBlocks(text, blocks))) {
		if (line.length < 12 || line.length > MAX_LINE) continue;
		const hit = parseGbt7714(line) ?? parseIeee(line) ?? parseVancouver(line) ?? parseApa(line);
		if (hit === void 0) continue;
		const key = `${hit.style}:${hit.title.toLowerCase()}`;
		if (seen.has(key)) {
			const index = hits.findIndex((existing) => `${existing.style}:${existing.title.toLowerCase()}` === key);
			if (index >= 0 && scoreHit(hit) > scoreHit(hits[index])) hits[index] = hit;
			continue;
		}
		seen.add(key);
		hits.push(hit);
	}
	return hits;
}
// src/core/candidates.ts
const ORIGIN_PRIORITY = {
	model: 3,
	citation: 2,
	identifier: 1
};
function firstNonNull(...values) {
	return values.find((value) => value !== void 0);
}
/**
* Identity of a work: DOI, arXiv, PMID, PMCID, ISBN, report number, then
* normalized title+year, then the URL. Mirrors §5.2 of the plan.
*/
function dedupeKey(candidate) {
	if (candidate.doi !== "") return `doi:${candidate.doi}`;
	if (candidate.arxivId !== "") return `arxiv:${candidate.arxivId}`;
	if (candidate.pmid !== void 0 && candidate.pmid !== "") return `pmid:${candidate.pmid}`;
	if (candidate.pmcid !== void 0 && candidate.pmcid !== "") return `pmcid:${candidate.pmcid}`;
	if (candidate.isbn !== "") return `isbn:${candidate.isbn}`;
	if (candidate.reportNumber !== "") return `report:${candidate.reportNumber}`;
	const title = titleKey(candidate.title);
	if (title !== "") return `title:${title}|${candidate.year ?? ""}`;
	if (candidate.url !== "") return `url:${candidate.url}`;
	return candidate.key;
}
/** True when a candidate can at least be named: an identifier, a title or a URL. */
function hasIdentity(candidate) {
	return candidate.doi !== "" || candidate.arxivId !== "" || candidate.pmid !== void 0 && candidate.pmid !== "" || candidate.pmcid !== void 0 && candidate.pmcid !== "" || candidate.isbn !== "" || candidate.reportNumber !== "" || titleKey(candidate.title) !== "" || candidate.url !== "";
}
/**
* Keep only evidence seqs that actually exist in the window that was read.
*
* A model can name seq 999 for a 12-event session; storing that would make the
* annotation point at nothing. Unknown seqs are dropped, not guessed at.
*/
function sanitizeEvidence(seqs, window) {
	const kept = seqs.filter((seq) => Number.isInteger(seq) && seq >= 0 && (window === void 0 || window.has(seq)));
	return [...new Set(kept)].sort((a, b) => a - b);
}
function emptyCandidate(type, origin, confidence) {
	return {
		key: "",
		type,
		origins: [origin],
		doi: "",
		arxivId: "",
		isbn: "",
		reportNumber: "",
		url: "",
		title: "",
		authors: [],
		year: void 0,
		container: "",
		volume: "",
		issue: "",
		pages: "",
		confidence,
		needsModelEnrichment: true,
		evidence: []
	};
}
/** Identifier-only candidate: pins the work, says nothing about the prose. */
function candidateFromIdentifier(hit, seq) {
	const filled = {
		...emptyCandidate(typeForIdentifier(hit.kind), "identifier", hit.confidence),
		doi: hit.kind === "doi" ? hit.value : "",
		arxivId: hit.kind === "arxiv" ? hit.value : "",
		...hit.kind === "pmid" ? { pmid: hit.value } : {},
		...hit.kind === "pmcid" ? { pmcid: hit.value.toUpperCase() } : {},
		isbn: hit.kind === "isbn" ? hit.value : "",
		reportNumber: hit.kind === "report" ? hit.value : "",
		url: hit.kind === "url" ? hit.value : "",
		evidence: [seq]
	};
	return {
		...filled,
		key: dedupeKey(filled)
	};
}
function typeForIdentifier(kind) {
	switch (kind) {
		case "arxiv": return "preprint";
		case "isbn": return "book";
		case "report": return "report";
		case "url": return "webpage";
		default: return "journalArticle";
	}
}
/** Citation-string candidate: has prose fields, usually lacks an identifier. */
function candidateFromCitation(hit, seq, identifiers) {
	const attached = (kind) => identifiers.find((identifier) => identifier.kind === kind)?.value ?? "";
	const pmid = attached("pmid");
	const pmcid = attached("pmcid").toUpperCase();
	const filled = {
		...emptyCandidate(hit.type, "citation", hit.confidence),
		doi: hit.doi !== "" ? hit.doi : attached("doi"),
		arxivId: attached("arxiv"),
		...pmid === "" ? {} : { pmid },
		...pmcid === "" ? {} : { pmcid },
		isbn: attached("isbn"),
		reportNumber: attached("report"),
		title: hit.title,
		authors: hit.authors,
		year: hit.year,
		container: hit.container,
		volume: hit.volume,
		issue: hit.issue,
		pages: hit.pages,
		evidence: [seq],
		needsModelEnrichment: hit.authors.length === 0 || hit.container === ""
	};
	return {
		...filled,
		key: dedupeKey(filled)
	};
}
function nonEmpty(value, fallback) {
	return value !== "" ? value : fallback;
}
/**
* Model-supplied candidate (Pass 3).
*
* Confidence is 0.9, not 1: it means "the model stated these fields", which
* earns precedence over regex guesses during merge but says nothing about
* whether the work exists. Only verification (M2) can raise that.
*/
function candidateFromModel(input) {
	const base = emptyCandidate(input.type ?? "journalArticle", "model", .9);
	const authors = (input.authors ?? []).map((author) => collapseSpace(author)).filter((author) => author !== "");
	const pmid = (input.pmid ?? "").trim();
	const pmcid = (input.pmcid ?? "").trim().toUpperCase();
	const filled = {
		...base,
		doi: normalizeDoi(input.doi ?? ""),
		arxivId: normalizeArxiv(input.arxivId ?? ""),
		.../^\d{6,8}$/u.test(pmid) ? { pmid } : {},
		.../^PMC\d+$/u.test(pmcid) ? { pmcid } : {},
		isbn: normalizeIsbn(input.isbn ?? ""),
		reportNumber: collapseSpace(input.reportNumber ?? ""),
		url: (input.url ?? "").trim(),
		title: collapseSpace(input.title),
		authors,
		year: input.year,
		container: collapseSpace(input.container ?? ""),
		volume: (input.volume ?? "").trim(),
		issue: (input.issue ?? "").trim(),
		pages: (input.pages ?? "").trim(),
		evidence: [...new Set(input.evidence ?? [])].sort((a, b) => a - b)
	};
	return {
		...filled,
		key: dedupeKey(filled),
		needsModelEnrichment: filled.title === "" || filled.year === void 0 || authors.length === 0
	};
}
/**
* Merge two observations of the same work.
*
* Field-level rule: an incoming value wins only when the current one is empty,
* unless the incoming origin outranks the current best origin (a model-supplied
* title beats a regex guess). Evidence and origins always accumulate.
*/
function mergeCandidates(current, incoming) {
	const bestOrigin = (candidate) => [...candidate.origins].sort((a, b) => ORIGIN_PRIORITY[b] - ORIGIN_PRIORITY[a])[0] ?? "identifier";
	const incomingWins = ORIGIN_PRIORITY[bestOrigin(incoming)] > ORIGIN_PRIORITY[bestOrigin(current)];
	const pick = (mine, theirs) => mine === "" || incomingWins && theirs !== "" ? nonEmpty(theirs, mine) : mine;
	const pickOptional = (mine, theirs) => {
		if (mine === void 0 || mine === "") return theirs;
		return incomingWins && theirs !== void 0 && theirs !== "" ? theirs : mine;
	};
	const merged = {
		key: current.key,
		type: incomingWins ? incoming.type : current.type,
		origins: [.../* @__PURE__ */ new Set([...current.origins, ...incoming.origins])],
		doi: pick(current.doi, incoming.doi),
		arxivId: pick(current.arxivId, incoming.arxivId),
		pmid: pickOptional(current.pmid, incoming.pmid),
		pmcid: pickOptional(current.pmcid, incoming.pmcid),
		isbn: pick(current.isbn, incoming.isbn),
		reportNumber: pick(current.reportNumber, incoming.reportNumber),
		url: pick(current.url, incoming.url),
		title: pick(current.title, incoming.title),
		authors: incomingWins && incoming.authors.length > 0 ? incoming.authors : current.authors.length > 0 ? current.authors : incoming.authors,
		year: incomingWins && incoming.year !== void 0 ? incoming.year : firstNonNull(current.year, incoming.year) ?? incoming.year,
		container: pick(current.container, incoming.container),
		volume: pick(current.volume, incoming.volume),
		issue: pick(current.issue, incoming.issue),
		pages: pick(current.pages, incoming.pages),
		confidence: Math.max(current.confidence, incoming.confidence),
		needsModelEnrichment: false,
		evidence: [.../* @__PURE__ */ new Set([...current.evidence, ...incoming.evidence])].sort((a, b) => a - b)
	};
	return {
		...merged,
		key: dedupeKey(merged),
		needsModelEnrichment: merged.title === "" || merged.year === void 0 || merged.authors.length === 0
	};
}
/** Order candidates for review: most trustworthy and most complete first. */
function rankCandidates(candidates) {
	const typeRank = {
		journalArticle: 0,
		conferencePaper: 1,
		preprint: 2,
		report: 3,
		thesis: 4,
		book: 5,
		webpage: 6
	};
	return [...candidates].sort((a, b) => {
		if (b.confidence !== a.confidence) return b.confidence - a.confidence;
		if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type];
		if (a.title !== b.title) return a.title < b.title ? -1 : 1;
		return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
	});
}
/**
* Extract and dedupe candidates from conversation text slices.
*
* Per slice: parse citation strings first, then attach any identifier found in
* the same line; identifiers not consumed by a citation become their own
* candidates. Across slices: merge by `dedupeKey` so the same paper cited in
* three turns is one candidate with three evidence seqs.
*/
function extractCandidates(sources, options = {}) {
	const byKey = /* @__PURE__ */ new Map();
	const byTitle = /* @__PURE__ */ new Map();
	const titleSlot = (candidate) => {
		if (candidate.title === "") return void 0;
		return `${titleKey(candidate.title)}|${String(candidate.year ?? "")}`;
	};
	const rebuildByTitle = () => {
		byTitle.clear();
		for (const [key, existing] of byKey) {
			const slot = titleSlot(existing);
			if (slot !== void 0 && !byTitle.has(slot)) byTitle.set(slot, key);
		}
	};
	const absorb = (candidate) => {
		if (!hasIdentity(candidate) || candidate.key === "") return;
		let merged = candidate;
		const absorbedKeys = /* @__PURE__ */ new Set();
		let absorbed = true;
		while (absorbed) {
			absorbed = false;
			const slot = titleSlot(merged);
			const titleTwin = slot === void 0 ? void 0 : byTitle.get(slot);
			for (const key of [merged.key, titleTwin]) {
				if (key === void 0 || absorbedKeys.has(key)) continue;
				const existing = byKey.get(key);
				if (existing === void 0) continue;
				absorbedKeys.add(key);
				merged = mergeCandidates(existing, merged);
				absorbed = true;
			}
		}
		for (const key of absorbedKeys) byKey.delete(key);
		byKey.set(merged.key, merged);
		rebuildByTitle();
	};
	for (const source of sources) {
		const identifiers = extractIdentifiers(source.text);
		if (source.role === "tool") {
			if (options.includeTools !== true) continue;
			for (const identifier of identifiers) {
				if (identifier.kind !== "doi" && identifier.kind !== "arxiv" && identifier.kind !== "pmid" && identifier.kind !== "pmcid" && identifier.kind !== "url") continue;
				if (identifier.kind === "url" && identifier.confidence < .7) continue;
				absorb(candidateFromIdentifier(identifier, source.seq));
			}
			continue;
		}
		const citations = extractCitations(source.text);
		const consumed = /* @__PURE__ */ new Set();
		for (const citation of citations) {
			const inLine = identifiers.filter((identifier) => citation.raw.includes(identifier.raw));
			for (const identifier of inLine) consumed.add(identifier);
			absorb(candidateFromCitation(citation, source.seq, inLine));
		}
		for (const identifier of identifiers) {
			if (consumed.has(identifier)) continue;
			if (identifier.kind === "url" && identifier.confidence < .7) continue;
			if (identifier.kind === "report" && identifier.confidence < .5) continue;
			absorb(candidateFromIdentifier(identifier, source.seq));
		}
	}
	return rankCandidates([...byKey.values()]);
}
const DEFAULT_MAX_REFERENCES = 5e3;
const REF_TYPES = [
	"journalArticle",
	"conferencePaper",
	"preprint",
	"report",
	"thesis",
	"book",
	"webpage"
];
/** Raised for anything the caller must surface verbatim: corrupt file,
* unsupported schema, capacity overflow, lock contention. */
var StoreError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.name = "StoreError";
		this.code = code;
	}
};
function emptyStore(now) {
	return {
		schemaVersion: 1,
		updatedAt: now,
		references: []
	};
}
function emptyQuarantine(now) {
	return {
		schemaVersion: 1,
		updatedAt: now,
		entries: []
	};
}
/** Canonical identity: prefer persistent identifiers, then normalized title+year. */
function referenceIdentityKey(ref) {
	const { doi, arxiv, isbn, reportNumber } = ref.identifiers;
	if (doi?.trim()) return `doi:${doi.trim().toLowerCase()}`;
	if (arxiv?.trim()) return `arxiv:${arxiv.trim().toLowerCase()}`;
	if (isbn?.trim()) return `isbn:${isbn.replace(/[-\s]/gu, "").toLowerCase()}`;
	if (reportNumber?.trim()) return `report:${reportNumber.trim().toLowerCase()}`;
	return `title:${stripMarkup(ref.title).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim()}|${ref.year ?? ""}`;
}
function referenceId(ref) {
	return referenceIdentityKey(ref);
}
/** Deterministic order: addedAt then id, so two exports of one store are byte-identical. */
function sortReferences(refs) {
	return [...refs].sort((a, b) => {
		if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}
// src/core/annotation-text.ts
/**
* Reject model text that talks about the evidence instead of the work.
*
* Asked for "why this work is cited", a model with a thin excerpt tends to
* answer meta-questions: "the excerpt does not mention this reference", "no
* citation sentence is available", "cannot be determined from the given text".
* Those sentences say nothing about the reference, and in BibTeX `note`, RIS
* `N1` or `annotated.md` they read as if the library believed them. A field
* that is absent is honest; a field that explains its own absence is noise.
*
* The check is deliberately blunt: any sentence about "the excerpt", "the
* context" or "the given text" is commentary, because a real annotation talks
* about the paper, not about the material the annotator was handed.
*/
const META_COMMENTARY = [
	/\b(?:the|this|that|supplied|given|provided|available|above|conversation)\s+(?:excerpt|text|context|passage|snippet|transcript)\b/iu,
	/\bruntime and workspace context\b/iu,
	/\b(?:does|do|did)\s+not\s+(?:mention|cite|state|say|contain|include|provide|describe|specify|refer)\b/iu,
	/\bno\s+(?:citation|reference|mention)\s+(?:sentence|statement|is|was)\b/iu,
	/\b(?:cannot|can\s+not|can't)\s+be\s+(?:determined|inferred|established|known)\b/iu,
	/\b(?:no|without)\s+(?:statement|indication|evidence)\s+(?:of|that|why)\b/iu,
	/\bnot\s+(?:available|present|provided)\s+in\s+(?:the|this)\b/iu,
	/\bno\s+(?:relevant\s+)?(?:information|details|content|context)\s+(?:is|was|are|were)\s+(?:available|provided|given)\b/iu,
	/\bnothing\s+in\s+(?:the|this)\s+(?:excerpt|context|passage|text)\b/iu,
	/\bthe\s+(?:excerpt|context|passage)\s+(?:is|only|consists|contains)\b/iu,
	/(?:摘录|片段|上下文|原文|对话内容)/u,
	/未(?:提及|提到|说明|提供|包含|涉及)/u,
	/(?:无法|不能)(?:确定|判断|推断|得知)/u,
	/(?:没有|无)(?:可用的)?\s*(?:引用|出处|依据|相关信息|相关内容)/u
];
/** Annotation text with meta-commentary removed; empty string means "leave the field out". */
function usefulAnnotationText(value) {
	const text = (value ?? "").trim();
	if (text === "") return "";
	return META_COMMENTARY.some((pattern) => pattern.test(text)) ? "" : text;
}
// src/export/bibtex.ts
const MANUAL_NOTE = "Manual entry: stored without registry verification.";
const TYPE_MAP = {
	journalArticle: "article",
	conferencePaper: "inproceedings",
	preprint: "misc",
	report: "techreport",
	thesis: "phdthesis",
	book: "book",
	webpage: "misc"
};
/** BibTeX specials. Braces are escaped too: reference titles occasionally carry
* literal braces, and an unbalanced brace silently breaks the whole entry. */
const SPECIALS = {
	"\\": "\\textbackslash{}",
	"{": "\\{",
	"}": "\\}",
	"&": "\\&",
	"%": "\\%",
	"#": "\\#",
	_: "\\_",
	$: "\\$",
	"~": "\\textasciitilde{}",
	"^": "\\textasciicircum{}"
};
function escapeBibtex(value) {
	let out = "";
	for (const char of value) out += SPECIALS[char] ?? char;
	return out.replace(/\s+/gu, " ").trim();
}
function bibtexAuthor(author) {
	if (author.literal) return escapeBibtex(author.literal);
	const family = author.family ?? "";
	const given = author.given ?? "";
	if (family && given) return `${escapeBibtex(family)}, ${escapeBibtex(given)}`;
	return escapeBibtex(family || given);
}
function normalisePages(pages) {
	if (pages.includes("--")) return pages;
	return pages.replace(/\s*[-–—]\s*/gu, "--");
}
function asciiKeyPart(text) {
	return text.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}
/** `familyYYYYfirstword`, ASCII-only, de-duplicated with a/b/c suffixes. */
function makeCiteKey(ref, taken) {
	if (ref.bibtexKey && !taken.has(ref.bibtexKey)) return ref.bibtexKey;
	const first = ref.authors[0];
	const base = `${asciiKeyPart(first ? first.family ?? first.literal ?? "" : "") || "anon"}${ref.year !== void 0 ? String(ref.year) : "nd"}${ref.title.split(/\s+/u).map((part) => asciiKeyPart(part)).find((part) => part.length > 2 && ![
		"the",
		"and",
		"for",
		"with",
		"from"
	].includes(part)) ?? ""}`;
	let key = base;
	let suffix = 0;
	while (taken.has(key)) {
		suffix += 1;
		key = `${base}${String.fromCharCode(96 + suffix)}`;
	}
	return key;
}
function bibtexFields(ref) {
	const fields = [];
	const push = (name, value) => {
		if (value !== void 0 && value !== "") fields.push([name, value]);
	};
	if (ref.authors.length > 0) push("author", ref.authors.map(bibtexAuthor).join(" and "));
	push("title", escapeBibtex(ref.title));
	if (ref.type === "journalArticle") push("journal", ref.containerTitle ? escapeBibtex(ref.containerTitle) : void 0);
	if (ref.type === "conferencePaper") push("booktitle", ref.containerTitle ? escapeBibtex(ref.containerTitle) : void 0);
	if (ref.year !== void 0) push("year", String(ref.year));
	push("volume", ref.volume);
	push("number", ref.issue);
	push("pages", ref.pages ? normalisePages(ref.pages) : void 0);
	if (ref.type === "report") {
		push("number", ref.identifiers.reportNumber ?? ref.issue);
		push("institution", ref.publisher);
	} else if (ref.type === "thesis") push("school", ref.publisher);
	else if (ref.type === "book") {
		push("publisher", ref.publisher);
		push("address", ref.publisherPlace);
	} else push("publisher", ref.publisher);
	if (ref.identifiers.isbn) push("isbn", ref.identifiers.isbn);
	if (ref.identifiers.doi) push("doi", ref.identifiers.doi);
	if (ref.identifiers.arxiv) {
		push("eprint", ref.identifiers.arxiv);
		push("archivePrefix", "arXiv");
	}
	if (ref.type === "preprint") push("howpublished", "arXiv preprint");
	if (ref.type === "webpage") push("howpublished", "web");
	push("url", ref.url);
	if (ref.accessed) push("urldate", ref.accessed);
	push("language", ref.language);
	const annotation = ref.annotation;
	if (annotation?.summary) push("abstract", escapeBibtex(annotation.summary));
	const noteParts = [
		annotation?.caveats ?? "",
		ref.verification.status === "manual" ? MANUAL_NOTE : "",
		ref.identifiers.pmid ? `PMID: ${ref.identifiers.pmid}` : "",
		ref.identifiers.pmcid ? `PMC: ${ref.identifiers.pmcid}` : ""
	].filter((part) => part !== "");
	if (noteParts.length > 0) push("note", escapeBibtex(noteParts.join(" ")));
	return fields;
}
function renderBibtexEntry(ref, taken) {
	const key = makeCiteKey(ref, taken);
	taken.add(key);
	const body = bibtexFields(ref).map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
	return `@${TYPE_MAP[ref.type]}{${key},\n${body}\n}\n`;
}
/** Entries are ordered by author-year-title so repeated exports are byte-stable. */
function renderBibtex(refs) {
	const sorted = [...refs].sort((a, b) => {
		const left = `${bibtexAuthor(a.authors[0] ?? {})}|${String(a.year ?? 0)}|${a.title}`;
		const right = `${bibtexAuthor(b.authors[0] ?? {})}|${String(b.year ?? 0)}|${b.title}`;
		return left < right ? -1 : left > right ? 1 : 0;
	});
	const taken = /* @__PURE__ */ new Set();
	return `% Generated by dsh-refkeeper. Verified entries only.\n\n${sorted.map((ref) => renderBibtexEntry(ref, taken)).join("\n")}`;
}
// src/export/ris.ts
const RIS_TYPE = {
	journalArticle: "JOUR",
	conferencePaper: "CONF",
	preprint: "UNPB",
	report: "RPRT",
	thesis: "THES",
	book: "BOOK",
	webpage: "ELEC"
};
function risAuthor(author) {
	if (author.literal) return author.literal;
	const family = author.family ?? "";
	const given = author.given ?? "";
	if (family && given) return `${family}, ${given}`;
	return family || given;
}
function pages(pages) {
	if (!pages) return [];
	const [start, end] = pages.split(/\s*(?:--|[-–—])\s*/u, 2);
	if (!start) return [];
	const rows = [["SP", start]];
	if (end) rows.push(["EP", end]);
	return rows;
}
function renderRisEntry(ref) {
	const rows = [["TY", RIS_TYPE[ref.type]]];
	for (const author of ref.authors) {
		const value = risAuthor(author);
		if (value) rows.push(["AU", value]);
	}
	rows.push(["TI", ref.title]);
	if (ref.containerTitle) rows.push(["T2", ref.containerTitle]);
	if (ref.year !== void 0) rows.push(["PY", String(ref.year)]);
	if (ref.volume) rows.push(["VL", ref.volume]);
	if (ref.issue) rows.push(["IS", ref.issue]);
	rows.push(...pages(ref.pages));
	if (ref.publisher) rows.push(["PB", ref.publisher]);
	if (ref.publisherPlace) rows.push(["CY", ref.publisherPlace]);
	if (ref.identifiers.doi) rows.push(["DO", ref.identifiers.doi]);
	if (ref.identifiers.arxiv) rows.push(["AN", `arXiv:${ref.identifiers.arxiv}`]);
	if (ref.identifiers.isbn) rows.push(["SN", ref.identifiers.isbn]);
	if (ref.identifiers.reportNumber) rows.push(["AN", ref.identifiers.reportNumber]);
	if (ref.identifiers.pmid) rows.push(["AN", `PMID:${ref.identifiers.pmid}`]);
	if (ref.identifiers.pmcid) rows.push(["AN", `PMC:${ref.identifiers.pmcid}`]);
	if (ref.url) rows.push(["UR", ref.url]);
	const annotation = ref.annotation;
	if (annotation?.summary) rows.push(["AB", annotation.summary]);
	if (annotation?.relevance) rows.push(["N1", annotation.relevance]);
	if (annotation?.evidence) rows.push(["N1", `Evidence: ${annotation.evidence}`]);
	if (annotation?.caveats) rows.push(["N1", `Caveats: ${annotation.caveats}`]);
	if (ref.verification.status === "manual") rows.push(["N1", "Status: manual entry, stored without registry verification."]);
	if (ref.language) rows.push(["LA", ref.language]);
	for (const tag of ref.tags ?? []) rows.push(["KW", tag]);
	rows.push(["ER", ""]);
	return `${rows.map(([tag, value]) => `${tag}  - ${value}`).join("\n")}\n`;
}
/** Same ordering rule as BibTeX: author, year, title. */
function renderRis(refs) {
	return [...refs].sort((a, b) => {
		const left = `${risAuthor(a.authors[0] ?? {})}|${String(a.year ?? 0)}|${a.title}`;
		const right = `${risAuthor(b.authors[0] ?? {})}|${String(b.year ?? 0)}|${b.title}`;
		return left < right ? -1 : left > right ? 1 : 0;
	}).map((ref) => renderRisEntry(ref)).join("\n");
}
// src/export/index.ts
const EXPORT_EXTENSIONS = {
	bibtex: "bib",
	ris: "ris"
};
/**
* Strip Markdown decoration that slipped in before the parsers cleaned it.
*
* The library outlives the parser: rows written by an earlier version still
* carry `> Daly, C.` in the author list and `*International Journal of
* Climatology*` in the journal, and re-capturing every paper to fix a stray
* character is not a reasonable ask. Cleaning at the render boundary keeps one
* rule — what leaves the plugin is clean — without rewriting the user's library
* behind their back. Identifiers and URLs stay untouched: `*` is legal in a
* quarantine id and `_` is legal in a DOI.
*/
function cleanAnnotation(annotation) {
	if (annotation === void 0) return void 0;
	const kept = {
		summary: usefulAnnotationText(annotation.summary),
		relevance: usefulAnnotationText(annotation.relevance),
		evidence: usefulAnnotationText(annotation.evidence),
		caveats: usefulAnnotationText(annotation.caveats)
	};
	const rows = {
		...kept.summary === "" ? {} : { summary: kept.summary },
		...kept.relevance === "" ? {} : { relevance: kept.relevance },
		...kept.evidence === "" ? {} : { evidence: kept.evidence },
		...kept.caveats === "" ? {} : { caveats: kept.caveats }
	};
	if (Object.keys(rows).length === 0) return void 0;
	return {
		...annotation.source === void 0 ? {} : { source: annotation.source },
		...annotation.status === void 0 ? {} : { status: annotation.status },
		...annotation.updatedAt === void 0 ? {} : { updatedAt: annotation.updatedAt },
		...rows
	};
}
function cleanForExport(ref) {
	return {
		...ref,
		...ref.annotation === void 0 ? {} : { annotation: cleanAnnotation(ref.annotation) },
		title: stripMarkup(ref.title),
		...ref.containerTitle === void 0 ? {} : { containerTitle: stripMarkup(ref.containerTitle) },
		...ref.publisher === void 0 ? {} : { publisher: stripMarkup(ref.publisher) },
		...ref.publisherPlace === void 0 ? {} : { publisherPlace: stripMarkup(ref.publisherPlace) },
		authors: ref.authors.map((author) => author.literal !== void 0 && author.literal !== "" ? {
			...author,
			literal: stripMarkup(author.literal)
		} : {
			...author,
			...author.family === void 0 ? {} : { family: stripMarkup(author.family) },
			...author.given === void 0 ? {} : { given: stripMarkup(author.given) }
		})
	};
}
function renderExport(format, refs) {
	const clean = refs.map(cleanForExport);
	return format === "bibtex" ? renderBibtex(clean) : renderRis(clean);
}
// src/verify/match.ts
/**
* The three comparison predicates of §5.3, isolated from anything that fetches.
*
* Every predicate answers "do these two describe the same work" using the
* candidate's own fields against one registry record. Thresholds are the plan's
* defaults; they are constants here so a report can cite the number that failed.
*/
/** Title thresholds from §5.3 (Jaccard / edit similarity / CJK Dice). */
const TITLE = {
	latinJaccard: .85,
	latinEdit: .85,
	latinStrong: .95,
	cjkDice: .9
};
/** Levenshtein distance over code points, iterative two-row implementation. */
function editDistance(a, b) {
	if (a === b) return 0;
	if (a === "" || b === "") return Math.max(a.length, b.length);
	const left = [...a];
	const right = [...b];
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let i = 1; i <= left.length; i += 1) {
		const current = [i];
		for (let j = 1; j <= right.length; j += 1) {
			const cost = left[i - 1] === right[j - 1] ? 0 : 1;
			const deletion = (previous[j] ?? 0) + 1;
			const insertion = (current[j - 1] ?? 0) + 1;
			const substitution = (previous[j - 1] ?? 0) + cost;
			current[j] = Math.min(deletion, insertion, substitution);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}
/** 1 - distance/len, computed on the folded strings so case/punctuation do not count. */
function editSimilarity(a, b) {
	const left = titleKey(a);
	const right = titleKey(b);
	if (left === "" || right === "") return 0;
	if (left === right) return 1;
	const longest = Math.max([...left].length, [...right].length);
	return 1 - editDistance(left, right) / longest;
}
/**
* Title similarity 0..1.
*
* CJK titles are compared as character bigrams (word tokenization does not
* exist for them); Latin titles use token overlap, which is robust to word order
* and to the subtitle suffixes registries add.
*/
function titleSimilarity(a, b) {
	if (titleKey(a) === "" || titleKey(b) === "") return 0;
	if (hasCjk(a) || hasCjk(b)) return diceBigrams(foldText(a), foldText(b));
	return jaccard(a, b);
}
/** Condition 1: strong overlap, per the plan's dual threshold. */
function titleMatches(candidateTitle, recordTitle) {
	if (hasCjk(candidateTitle) || hasCjk(recordTitle)) return diceBigrams(foldText(candidateTitle), foldText(recordTitle)) >= TITLE.cjkDice;
	const tokens = jaccard(candidateTitle, recordTitle);
	const edit = editSimilarity(candidateTitle, recordTitle);
	if (tokens >= TITLE.latinStrong || edit >= TITLE.latinStrong) return true;
	return tokens >= TITLE.latinJaccard && edit >= TITLE.latinEdit;
}
/** Condition 2: years within one, both known. An unknown year never matches. */
function yearMatches(candidateYear, recordYear) {
	if (candidateYear === void 0 || recordYear === void 0) return false;
	return Math.abs(candidateYear - recordYear) <= 1;
}
/**
* Family name of one author string.
*
* Handles the three forms the extractors actually produce: `Zhang, S.` (family
* before the comma), `S. Zhang` (initials first) and `张三` (no split). Anything
* else falls back to the whole string rather than guessing a surname.
*/
function familyName(author) {
	const trimmed = author.trim();
	if (trimmed === "") return "";
	if (trimmed.includes(",")) return (trimmed.split(",")[0] ?? "").trim();
	if (hasCjk(trimmed)) return trimmed;
	const parts = trimmed.split(/\s+/u).filter((part) => part !== "");
	const withoutInitials = parts.filter((part) => !/^[A-Z]\.?$/u.test(part));
	const pool = withoutInitials.length > 0 ? withoutInitials : parts;
	return pool[pool.length - 1] ?? "";
}
/** Condition 3: first author's family name equal, or one edit apart when long. */
function firstAuthorMatches(candidateAuthors, recordAuthors) {
	const ours = familyName(candidateAuthors[0] ?? "");
	const theirs = familyName(recordAuthors[0] ?? "");
	if (ours === "" || theirs === "") return false;
	const left = hasCjk(ours) || hasCjk(theirs) ? foldText(ours).replace(/\s+/gu, "") : titleKey(ours);
	const right = hasCjk(ours) || hasCjk(theirs) ? foldText(theirs).replace(/\s+/gu, "") : titleKey(theirs);
	if (left === "" || right === "") return false;
	if (left === right) return true;
	if ([...left].length < 4 || [...right].length < 4) return false;
	return editDistance(left, right) <= 1;
}
// src/verify/judge.ts
/** Minimum best-record score before any condition is even considered. */
const MIN_RECORD_SCORE = .75;
/** §5.3 candidate selection score for one registry record. */
function scoreRecord(candidate, record) {
	const title = titleSimilarity(candidate.title, record.title);
	const year = yearMatches(candidate.year, record.year) ? 1 : 0;
	const author = firstAuthorMatches(candidate.authors, record.authors) ? 1 : 0;
	return .6 * title + .25 * year + .15 * author;
}
function check(pass, ours, theirs, score) {
	return {
		pass,
		ours,
		theirs,
		score
	};
}
const EMPTY_CHECK = (ours) => ({
	pass: false,
	ours,
	theirs: "",
	score: 0
});
/**
* Judge one candidate against every record the sources returned.
*
* `errors`/`timedOut` come from the caller's transport layer: they are the only
* way this function can know that "no record" means "the source failed" rather
* than "the work does not exist".
*/
function judgeCandidate(input) {
	const { candidate, records } = input;
	const errors = input.errors ?? [];
	const sources = [...new Set(records.map((record) => record.source))];
	const partial = errors.length > 0 || input.timedOut === true;
	const base = {
		sources,
		partial,
		matchedSource: void 0
	};
	const best = records.map((record) => ({
		record,
		score: scoreRecord(candidate, record)
	})).sort((a, b) => b.score - a.score)[0];
	if (best === void 0) {
		const reasons = [];
		if (input.timedOut === true) reasons.push("timeout");
		if (errors.length > 0) reasons.push("source-error");
		const answered = (input.answered ?? (partial ? [] : sources)).length > 0 && !partial;
		if (answered) reasons.push("no-source-hit");
		return {
			...base,
			status: answered ? "quarantined" : "unverified",
			title: EMPTY_CHECK(candidate.title),
			year: EMPTY_CHECK(String(candidate.year ?? "")),
			firstAuthor: EMPTY_CHECK(familyName(candidate.authors[0] ?? "")),
			passed: 0,
			reasons
		};
	}
	if (best.score < .75) {
		const reasons = ["ambiguous-record"];
		if (input.timedOut === true) reasons.push("timeout");
		if (errors.length > 0) reasons.push("source-error");
		return {
			...base,
			status: partial ? "unverified" : "quarantined",
			title: EMPTY_CHECK(candidate.title),
			year: EMPTY_CHECK(String(candidate.year ?? "")),
			firstAuthor: EMPTY_CHECK(familyName(candidate.authors[0] ?? "")),
			passed: 0,
			reasons
		};
	}
	const record = best.record;
	const title = check(titleMatches(candidate.title, record.title), candidate.title, record.title, titleSimilarity(candidate.title, record.title));
	const year = check(yearMatches(candidate.year, record.year), candidate.year === void 0 ? "(unknown)" : String(candidate.year), record.year === void 0 ? "(unknown)" : String(record.year), -1);
	const firstAuthor = check(firstAuthorMatches(candidate.authors, record.authors), familyName(candidate.authors[0] ?? "") || "(unknown)", familyName(record.authors[0] ?? "") || "(unknown)", -1);
	const passed = [
		title,
		year,
		firstAuthor
	].filter((entry) => entry.pass).length;
	const reasons = [];
	if (!title.pass) reasons.push("title-mismatch");
	if (!year.pass) reasons.push("year-mismatch");
	if (!firstAuthor.pass) reasons.push("author-mismatch");
	if (input.timedOut === true) reasons.push("timeout");
	if (errors.length > 0) reasons.push("source-error");
	const status = partial ? "unverified" : passed === 3 && sources.length >= 1 ? "verified" : passed === 2 ? "warning" : "quarantined";
	return {
		...base,
		matchedSource: record.source,
		status,
		title,
		year,
		firstAuthor,
		passed,
		reasons
	};
}
export { isValidIsbn13 as $, candidateFromModel as A, splitAuthors as B, emptyQuarantine as C, sortReferences as D, referenceIdentityKey as E, rankCandidates as F, formatAuthorName as G, collapseSpace as H, sanitizeEvidence as I, stripMarkup as J, hasCjk as K, extractCitations as L, extractCandidates as M, hasIdentity as N, candidateFromCitation as O, mergeCandidates as P, isValidIsbn10 as Q, parseBibtexBlock as R, StoreError as S, referenceId as T, diceBigrams as U, clip as V, foldText as W, titleTokens as X, titleKey as Y, extractIdentifiers as Z, makeCiteKey as _, editDistance as a, DEFAULT_MAX_REFERENCES as b, firstAuthorMatches as c, yearMatches as d, normalizeArxiv as et, EXPORT_EXTENSIONS as f, escapeBibtex as g, renderRisEntry as h, TITLE as i, dedupeKey as j, candidateFromIdentifier as k, titleMatches as l, renderRis as m, judgeCandidate as n, normalizeIsbn as nt, editSimilarity as o, renderExport as p, jaccard as q, scoreRecord as r, familyName as s, MIN_RECORD_SCORE as t, normalizeDoi as tt, titleSimilarity as u, renderBibtex as v, emptyStore as w, REF_TYPES as x, usefulAnnotationText as y, parseBibtexBlocks as z };
