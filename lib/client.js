window.__ModuleLoader__.load({ id: "dsh-refkeeper", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  REGISTRANT: () => REGISTRANT,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);

// src/core/text.ts
function collapseSpace(input) {
  return input.replace(/[\s\u3000]+/gu, " ").trim();
}
function stripMarkup(input) {
  return collapseSpace(
    input.replace(/^(?:[ \t]*>)+[ \t]*/gmu, "").replace(/^[ \t]*[•·][ \t]*/gmu, "").replace(/^[ \t]*[-+][ \t]+/gmu, "").replace(/[*`]+/gu, "").replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu, "$1")
  ).replace(/^[\s>•*]+/u, "").replace(/[\s*]+$/u, "");
}

// src/core/batch.ts
var BATCH_MARKER = "refkeeper-batch:";
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
function sanitizeEntry(entry) {
  if (typeof entry !== "object" || entry === null) return void 0;
  const raw = entry;
  const status = raw["status"];
  if (status !== "saved" && status !== "quarantined" && status !== "skipped" && status !== "failed") {
    return void 0;
  }
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
function normalizeBatch(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const raw = value;
  if (!Array.isArray(raw["entries"])) return void 0;
  const entries = [];
  for (const entry of raw["entries"]) {
    const clean = sanitizeEntry(entry);
    if (clean !== void 0) entries.push(clean);
  }
  const chars = typeof raw["chars"] === "number" && Number.isSafeInteger(raw["chars"]) && raw["chars"] >= 0 ? raw["chars"] : void 0;
  return {
    capturedAt: typeof raw["capturedAt"] === "string" ? raw["capturedAt"] : "",
    scope: typeof raw["scope"] === "string" ? raw["scope"] : "",
    entries,
    ...raw["truncated"] === true ? { truncated: true } : {},
    ...chars === void 0 ? {} : { chars }
  };
}
function decodeBatch(text) {
  const at = text.lastIndexOf(BATCH_MARKER);
  if (at < 0) return void 0;
  const json = text.slice(at + BATCH_MARKER.length).trim();
  const direct = parseBatchJson(json);
  if (direct !== void 0) return direct;
  for (let cut = json.lastIndexOf("}"); cut > 0; cut = json.lastIndexOf("}", cut - 1)) {
    const attempt = parseBatchJson(json.slice(0, cut + 1));
    if (attempt !== void 0) return attempt;
  }
  return void 0;
}
function parseBatchJson(json) {
  try {
    return normalizeBatch(JSON.parse(json));
  } catch {
    return void 0;
  }
}

// src/ui/authors.ts
var INITIALS = /^(?:[A-Za-z]\.){1,4}$/u;
function parseAuthors(raw) {
  const tokens = raw.split(/[,，;；]/u).map((token) => token.trim()).filter((token) => token !== "");
  const authors = [];
  for (const token of tokens) {
    const previous = authors.at(-1);
    if (INITIALS.test(token) && previous !== void 0 && previous.given === void 0) {
      previous.given = token;
      continue;
    }
    authors.push({ family: token });
  }
  return authors;
}
function formatAuthor(author) {
  return author.given === void 0 || author.given === "" ? author.family : `${author.family}, ${author.given}`;
}
var SEVERAL_AUTHORS = /^[^\n,]+,\s*(?:[A-Za-z]\.){1,4}(?:\s*,\s*[^\n,]+(?:\s*,\s*(?:[A-Za-z]\.){1,4})?)*$/u;
function parseAuthorLines(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "").flatMap((line) => SEVERAL_AUTHORS.test(line) ? parseAuthors(line) : [{ family: line }]).map(formatAuthor).filter((author) => author !== "");
}

// src/ui/save-result.ts
function parseManualSaveResult(text) {
  const quarantined = /(?:^|\s)⚠\s*quarantined\s+(\S+)\s+→\s+refs\/quarantine\.json(?:\s|$)/.exec(text);
  if (quarantined !== null && quarantined[1] !== void 0) {
    return { id: quarantined[1], status: "quarantined", outcome: "quarantined" };
  }
  const editedQuarantine = /(?:^|\s)edited\s+(\S+)\s+→\s+refs\/quarantine\.json(?:\s|$)/.exec(text);
  if (editedQuarantine !== null && editedQuarantine[1] !== void 0) {
    return { id: editedQuarantine[1], status: "quarantined", outcome: "quarantined" };
  }
  const already = /(?:^|\s)already in the library\s+(\S+);/.exec(text);
  if (already !== null && already[1] !== void 0) {
    return { id: already[1], status: "saved", outcome: "already" };
  }
  const saved = /(?:^|\s)(?:saved|updated|edited)\s+(\S+)\s+→\s+refs\/refs\.json(?:\s|$)/.exec(text);
  if (saved !== null && saved[1] !== void 0) {
    return { id: saved[1], status: "saved", outcome: "saved" };
  }
  return void 0;
}
function entryReasonForMeta(status, reason) {
  return status === "saved" ? void 0 : reason;
}
function cachedCommandSnapshot(cache, sessionId, revision, size, serialize) {
  const current = cache.current;
  if (current !== void 0 && current.sessionId === sessionId && current.revision === revision && current.size === size) {
    return current.serialized;
  }
  const serialized = serialize();
  cache.current = { sessionId, revision, size, serialized };
  return serialized;
}

// src/core/registry-settings.ts
var REGISTRY_IDS = [
  "crossref",
  "datacite",
  "openalex",
  "arxiv",
  "pubmed",
  "openlibrary"
];
var DEFAULT_REGISTRY_BASE_URLS = {
  crossref: "https://api.crossref.org",
  datacite: "https://api.datacite.org",
  openalex: "https://api.openalex.org",
  arxiv: "https://export.arxiv.org",
  pubmed: "https://eutils.ncbi.nlm.nih.gov",
  openlibrary: "https://openlibrary.org"
};
function normalizeBaseUrl(value) {
  if (typeof value !== "string") return void 0;
  const text = value.trim();
  if (text === "") return void 0;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
    if (parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") return void 0;
    if (parsed.search !== "" || parsed.hash !== "") return void 0;
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return void 0;
  }
}
function normalizeRegistrySettings(input) {
  const candidate = typeof input === "object" && input !== null ? input : {};
  const rawBases = typeof candidate.registryBaseUrls === "object" && candidate.registryBaseUrls !== null ? candidate.registryBaseUrls : {};
  const warnings = [];
  const customRegistryIds = [];
  const registryBaseUrls = { ...DEFAULT_REGISTRY_BASE_URLS };
  for (const id of REGISTRY_IDS) {
    const rawValue = rawBases[id];
    if (rawValue === void 0 || rawValue === null || rawValue === "") continue;
    const normalized = normalizeBaseUrl(rawValue);
    if (normalized === void 0) {
      warnings.push(`invalid-registry-base-url:${id}`);
      continue;
    }
    registryBaseUrls[id] = normalized;
    if (normalized !== DEFAULT_REGISTRY_BASE_URLS[id]) customRegistryIds.push(id);
  }
  const mailto = typeof candidate.mailto === "string" ? candidate.mailto.trim() : "";
  const privateMode = candidate.privateMode === true;
  return {
    settings: { registryBaseUrls, mailto, privateMode },
    warnings,
    customRegistryIds
  };
}

// src/core/panel.ts
var DIR_MARKER = "refkeeper-dir:";
var REGISTRY_SETTINGS_MARKER = "refkeeper-settings:";
function decodeDir(text) {
  const at = text.lastIndexOf(DIR_MARKER);
  if (at < 0) return void 0;
  const rest = text.slice(at + DIR_MARKER.length);
  const newline = rest.indexOf("\n");
  const line = (newline < 0 ? rest : rest.slice(0, newline)).trim();
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return void 0;
    const dir = parsed.dir;
    if (dir === null) return { dir: null };
    if (typeof dir === "string" && dir !== "") return { dir };
    return void 0;
  } catch {
    return void 0;
  }
}
function decodeRegistrySettings(text) {
  const at = text.lastIndexOf(REGISTRY_SETTINGS_MARKER);
  if (at < 0) return void 0;
  const rest = text.slice(at + REGISTRY_SETTINGS_MARKER.length);
  const newline = rest.indexOf("\n");
  const line = (newline < 0 ? rest : rest.slice(0, newline)).trim();
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return void 0;
    const snapshot = parsed;
    if (typeof snapshot.settings !== "object" || snapshot.settings === null) return void 0;
    const normalized = normalizeRegistrySettings(snapshot.settings);
    const savedWarnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.filter((warning) => typeof warning === "string") : [];
    return {
      ...normalized,
      warnings: [.../* @__PURE__ */ new Set([...savedWarnings, ...normalized.warnings])]
    };
  } catch {
    return void 0;
  }
}

// src/ui/payload.ts
var BASE64URL = { "+": "-", "/": "_" };
function encodeFlag(name, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).replace(/[+/]/gu, (char) => BASE64URL[char] ?? char);
  return `--${name}=${base64.replace(/=+$/u, "")}`;
}

// src/ui/strings.ts
var EN = {
  button: "Refs",
  buttonTitle: "Capture references from this conversation",
  heading: "Capture references",
  scopeLabel: "Scope",
  scopeTurn: "This turn",
  scopeLastN: "Last N turns",
  scopeAll: "Whole conversation",
  turnsLabel: "Turns",
  exportSelection: "Tick the references to export.",
  capture: "Capture references",
  export: "Export this capture",
  exportAll: "Export all references",
  defaultDirLabel: "Export to",
  storedNotice: "{n} saved to refs/refs.json in this workspace",
  defaultDirUnset: "not set (refs/exports/)",
  dirPlaceholder: "Paste a folder path\u2026",
  dirSave: "Save folder",
  dirClearLabel: "Clear",
  formatLabel: "Formats",
  formatBibtex: "BibTeX",
  formatRis: "RIS",
  formatCslJson: "CSL-JSON",
  captureTruncated: "Scan budget reached: the newest complete messages total {chars} characters; older content was omitted.",
  batchHeading: "Last capture",
  batchEmpty: "Nothing captured yet \u2014 the export buttons then fall back to the whole library.",
  refresh: "Refresh list",
  selectedCount: "{n} selected for export",
  authorConjunction: "and",
  manualOpen: "Enter manually",
  manualSave: "Save manually",
  fieldFirstAuthor: "First author",
  annotated: "annotated",
  promoteVerify: "Re-verify",
  promoteManual: "Store as manual",
  statusSaved: "saved",
  statusQuarantined: "\u26A0 quarantined",
  statusSkipped: "skipped",
  statusFailed: "failed",
  close: "Close",
  unavailable: "The composer is not ready yet; reopen the panel and retry.",
  detailsSave: "Save changes",
  detailsSaved: "Saved. Exports now use these fields.",
  detailsStale: "This entry was captured before field snapshots existed, so only its title, year and id are known. Capture again to pull the full record from the registries.",
  detailsReset: "Revert",
  manualSavePending: "Saving reference\u2026",
  manualSaveConfirmed: "Reference saved to your library.",
  manualSaveNextCapture: "This update will be included in the next capture.",
  manualSaveAlready: "This reference is already in your library.",
  manualSaveQuarantined: "Reference saved to quarantine for review.",
  manualSaveUnconfirmed: "Save result could not be confirmed. Check the command output.",
  detailsSubmitted: "Edit command submitted.",
  manualSaveValidation: "Enter a title, at least one author, and a valid year.",
  groupIdentifiers: "Identifiers",
  groupBibliography: "Bibliographic details",
  groupPublication: "Publication",
  quarantineNotice: "This reference is quarantined and may be excluded from standard exports until verified.",
  latestVerificationReasons: "Latest verification reasons:",
  detailBack: "Back to list",
  detailCreate: "Complete reference",
  detailEdit: "Edit reference",
  fieldType: "Type",
  fieldTitle: "Title",
  fieldAuthors: "Authors (one per line)",
  fieldAuthorsHint: "Family, Given",
  fieldContainer: "Publication",
  fieldYear: "Year",
  fieldVolume: "Volume",
  fieldIssue: "Issue",
  fieldPages: "Pages",
  fieldPublisher: "Publisher",
  fieldPlace: "Place",
  fieldLanguage: "Language",
  fieldDoi: "DOI",
  fieldArxiv: "arXiv ID",
  fieldPmid: "PMID",
  fieldPmcid: "PMCID",
  fieldIsbn: "ISBN",
  fieldReportNumber: "Report number",
  fieldLccn: "LCCN",
  fieldOclc: "OCLC",
  fieldOpenlibraryId: "Open Library ID",
  fieldUrl: "URL",
  registrySettingsHeading: "Registry settings",
  registrySettingsHint: "Base URLs only; registry paths are appended automatically. Leave defaults unchanged to use public endpoints.",
  registryPrivateMode: "Private mode (no registry requests)",
  registryPrivateModeHelp: "When enabled, captures are stored as manual and explicitly not verified; no registry requests are sent.",
  registryMailto: "Contact email (mailto)",
  registryCrossref: "Crossref base URL",
  registryDatacite: "DataCite base URL",
  registryOpenalex: "OpenAlex base URL",
  registryArxiv: "arXiv base URL",
  registryPubmed: "PubMed E-utilities base URL",
  registryOpenlibrary: "Open Library base URL",
  registryDefaultStatus: "Default",
  registryCustomStatus: "Custom",
  registrySettingsReload: "Reload settings",
  registrySettingsSave: "Save settings",
  registrySettingsLoading: "Loading registry settings\u2026",
  registrySettingsSaved: "Registry settings saved.",
  registrySettingsWarnings: "Invalid endpoint URL(s) were ignored; defaults are active for those registries.",
  registrySettingsUnavailable: "The composer is not ready; reopen the panel to manage registry settings."
};
var ZH = {
  button: "\u5F15\u7528",
  buttonTitle: "\u4ECE\u5F53\u524D\u5BF9\u8BDD\u4E2D\u6355\u83B7\u6587\u732E",
  heading: "\u6355\u83B7\u6587\u732E",
  scopeLabel: "\u8303\u56F4",
  scopeTurn: "\u672C\u8F6E",
  scopeLastN: "\u524D N \u8F6E",
  scopeAll: "\u5168\u90E8\u5BF9\u8BDD",
  turnsLabel: "\u8F6E\u6570",
  exportSelection: "\u52FE\u9009\u9700\u8981\u5BFC\u51FA\u7684\u6587\u732E",
  capture: "\u6355\u83B7\u6587\u732E",
  export: "\u5BFC\u51FA\u672C\u6B21\u6355\u83B7",
  exportAll: "\u5BFC\u51FA\u5168\u90E8\u6587\u732E",
  defaultDirLabel: "\u5BFC\u51FA\u5230",
  storedNotice: "{n} \u6761\u5DF2\u5B58\u5165\u5DE5\u4F5C\u533A\u7684 refs/refs.json",
  defaultDirUnset: "\u672A\u8BBE\u7F6E\uFF08refs/exports/\uFF09",
  dirPlaceholder: "\u7C98\u8D34\u6587\u4EF6\u5939\u8DEF\u5F84\u2026",
  dirSave: "\u4FDD\u5B58\u6587\u4EF6\u5939",
  dirClearLabel: "\u6E05\u9664",
  formatLabel: "\u5BFC\u51FA\u683C\u5F0F",
  formatBibtex: "BibTeX",
  formatRis: "RIS",
  formatCslJson: "CSL-JSON",
  captureTruncated: "\u5DF2\u8FBE\u5230\u626B\u63CF\u4E0A\u9650\uFF1A\u4FDD\u7559\u7684\u6700\u65B0\u5B8C\u6574\u6D88\u606F\u5408\u8BA1 {chars} \u4E2A\u5B57\u7B26\uFF1B\u66F4\u65E9\u5185\u5BB9\u672A\u7EB3\u5165\u3002",
  batchHeading: "\u6700\u8FD1\u4E00\u6B21\u6355\u83B7",
  batchEmpty: "\u8FD8\u6CA1\u6709\u6355\u83B7\u8BB0\u5F55\uFF1B\u6B64\u65F6\u5BFC\u51FA\u4F1A\u9000\u56DE\u6574\u5E93\u3002",
  refresh: "\u5237\u65B0\u5217\u8868",
  selectedCount: "\u5DF2\u9009\u62E9 {n} \u6761\u5F85\u5BFC\u51FA",
  authorConjunction: "\u548C",
  manualOpen: "\u624B\u52A8\u5165\u8868",
  manualSave: "\u4FDD\u5B58\u5E76\u5165\u8868",
  fieldFirstAuthor: "\u9996\u4F5C\u8005",
  annotated: "\u5DF2\u6CE8\u89E3",
  promoteVerify: "\u91CD\u65B0\u6838\u9A8C",
  promoteManual: "\u4EBA\u5DE5\u786E\u8BA4\u5165\u8868",
  statusSaved: "\u5DF2\u5165\u8868",
  statusQuarantined: "\u26A0 \u9694\u79BB",
  statusSkipped: "\u8DF3\u8FC7",
  statusFailed: "\u5931\u8D25",
  close: "\u5173\u95ED",
  unavailable: "\u8F93\u5165\u6846\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9762\u677F\u518D\u8BD5\u3002",
  detailsSave: "\u4FDD\u5B58\u4FEE\u6539",
  detailsSaved: "\u5DF2\u4FDD\u5B58\uFF0C\u5BFC\u51FA\u5C06\u4F7F\u7528\u4FEE\u6539\u540E\u7684\u5B57\u6BB5\u3002",
  detailsStale: "\u8FD9\u6761\u662F\u8F83\u65E9\u6355\u83B7\u7559\u4E0B\u7684\uFF0C\u53EA\u5B58\u4E86\u6807\u9898\u3001\u5E74\u4EFD\u548C\u6807\u8BC6\uFF0C\u6CA1\u6709\u5B8C\u6574\u5B57\u6BB5\u3002\u91CD\u65B0\u6355\u83B7\u4E00\u6B21\u5373\u53EF\u4ECE Crossref / OpenAlex \u8865\u5168\u3002",
  detailsReset: "\u8FD8\u539F",
  manualSavePending: "\u6B63\u5728\u4FDD\u5B58\u6761\u76EE\u2026",
  manualSaveConfirmed: "\u6761\u76EE\u5DF2\u4FDD\u5B58\u5230\u6587\u732E\u5E93\u3002",
  manualSaveNextCapture: "\u6B64\u66F4\u65B0\u5C06\u5728\u4E0B\u6B21\u6355\u83B7\u65F6\u6301\u4E45\u5316\u3002",
  manualSaveAlready: "\u8BE5\u6587\u732E\u5DF2\u5728\u6587\u732E\u5E93\u4E2D\u3002",
  manualSaveQuarantined: "\u6761\u76EE\u5DF2\u4FDD\u5B58\u5230\u9694\u79BB\u533A\uFF0C\u7B49\u5F85\u590D\u6838\u3002",
  manualSaveUnconfirmed: "\u65E0\u6CD5\u786E\u8BA4\u4FDD\u5B58\u7ED3\u679C\uFF0C\u8BF7\u68C0\u67E5\u547D\u4EE4\u8F93\u51FA\u3002",
  detailsSubmitted: "\u7F16\u8F91\u547D\u4EE4\u5DF2\u63D0\u4EA4\u3002",
  manualSaveValidation: "\u8BF7\u586B\u5199\u6807\u9898\u3001\u81F3\u5C11\u4E00\u4F4D\u4F5C\u8005\u548C\u6709\u6548\u5E74\u4EFD\u3002",
  groupIdentifiers: "\u6807\u8BC6\u4FE1\u606F",
  groupBibliography: "\u4E66\u76EE\u4FE1\u606F",
  groupPublication: "\u51FA\u7248\u4FE1\u606F",
  quarantineNotice: "\u8BE5\u6761\u76EE\u5904\u4E8E\u9694\u79BB\u72B6\u6001\uFF1B\u6838\u9A8C\u524D\u53EF\u80FD\u4E0D\u4F1A\u5305\u542B\u5728\u5E38\u89C4\u5BFC\u51FA\u4E2D\u3002",
  latestVerificationReasons: "\u6700\u8FD1\u4E00\u6B21\u6838\u9A8C\u539F\u56E0\uFF1A",
  detailBack: "\u8FD4\u56DE\u5217\u8868",
  detailCreate: "\u8865\u5168\u6587\u732E\u4FE1\u606F",
  detailEdit: "\u7F16\u8F91\u6587\u732E",
  fieldType: "\u6761\u76EE\u7C7B\u578B",
  fieldTitle: "\u6807\u9898",
  fieldAuthors: "\u4F5C\u8005\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09",
  fieldAuthorsHint: "\u201C\u59D3, \u540D\u201D",
  fieldContainer: "\u51FA\u7248\u7269",
  fieldYear: "\u5E74\u4EFD",
  fieldVolume: "\u5377",
  fieldIssue: "\u671F",
  fieldPages: "\u9875\u7801",
  fieldPublisher: "\u51FA\u7248\u793E",
  fieldPlace: "\u51FA\u7248\u5730",
  fieldLanguage: "\u8BED\u8A00",
  fieldDoi: "DOI",
  fieldArxiv: "arXiv ID",
  fieldPmid: "PMID",
  fieldPmcid: "PMCID",
  fieldIsbn: "ISBN",
  fieldReportNumber: "\u62A5\u544A\u53F7",
  fieldLccn: "LCCN",
  fieldOclc: "OCLC",
  fieldOpenlibraryId: "Open Library ID",
  fieldUrl: "URL",
  registrySettingsHeading: "\u6CE8\u518C\u6E90\u8BBE\u7F6E",
  registrySettingsHint: "\u4EC5\u586B\u5199\u57FA\u7840 URL\uFF1B\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u8FFD\u52A0\u6CE8\u518C\u6E90\u8DEF\u5F84\u3002\u4FDD\u7559\u9ED8\u8BA4\u5730\u5740\u5373\u53EF\u4F7F\u7528\u516C\u5171\u7AEF\u70B9\u3002",
  registryPrivateMode: "\u9690\u79C1\u6A21\u5F0F\uFF08\u4E0D\u53D1\u9001\u6CE8\u518C\u6E90\u8BF7\u6C42\uFF09",
  registryPrivateModeHelp: "\u542F\u7528\u540E\uFF0C\u6355\u83B7\u6761\u76EE\u4F1A\u6807\u8BB0\u4E3A\u4EBA\u5DE5\u4E14\u660E\u786E\u663E\u793A\u672A\u6838\u9A8C\uFF1B\u4E0D\u4F1A\u53D1\u9001\u4EFB\u4F55\u6CE8\u518C\u6E90\u8BF7\u6C42\u3002",
  registryMailto: "\u8054\u7CFB\u90AE\u7BB1\uFF08mailto\uFF09",
  registryCrossref: "Crossref \u57FA\u7840 URL",
  registryDatacite: "DataCite \u57FA\u7840 URL",
  registryOpenalex: "OpenAlex \u57FA\u7840 URL",
  registryArxiv: "arXiv \u57FA\u7840 URL",
  registryPubmed: "PubMed E-utilities \u57FA\u7840 URL",
  registryOpenlibrary: "Open Library \u57FA\u7840 URL",
  registryDefaultStatus: "\u9ED8\u8BA4",
  registryCustomStatus: "\u81EA\u5B9A\u4E49",
  registrySettingsReload: "\u91CD\u65B0\u8BFB\u53D6\u8BBE\u7F6E",
  registrySettingsSave: "\u4FDD\u5B58\u8BBE\u7F6E",
  registrySettingsLoading: "\u6B63\u5728\u8BFB\u53D6\u6CE8\u518C\u6E90\u8BBE\u7F6E\u2026",
  registrySettingsSaved: "\u6CE8\u518C\u6E90\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002",
  registrySettingsWarnings: "\u65E0\u6548\u7684\u7AEF\u70B9 URL \u5DF2\u5FFD\u7565\uFF1B\u76F8\u5E94\u6CE8\u518C\u6E90\u4F7F\u7528\u9ED8\u8BA4\u5730\u5740\u3002",
  registrySettingsUnavailable: "\u8F93\u5165\u6846\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9762\u677F\u7BA1\u7406\u6CE8\u518C\u6E90\u8BBE\u7F6E\u3002"
};
function stringsFor(tag) {
  return tag !== void 0 && tag.toLowerCase().startsWith("zh") ? ZH : EN;
}

// src/ui/tokens.ts
var UI_TOKENS = {
  spacing: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px"
  },
  radius: {
    control: "6px",
    panel: "10px"
  },
  fontSize: {
    caption: "11px",
    control: "12px"
  },
  layout: {
    sectionGap: "16px",
    groupGap: "12px",
    fieldGap: "8px",
    labelGap: "4px"
  },
  color: {
    success: "var(--dsw-alias-state-success-primary, #1a7f37)",
    warning: "var(--dsw-alias-state-warn-primary, #b26a00)",
    error: "var(--dsw-alias-state-error-primary, #b42318)",
    neutral: "var(--dsw-alias-label-secondary, #6b7280)"
  }
};

// src/store/types.ts
var REF_TYPES = [
  "journalArticle",
  "conferencePaper",
  "preprint",
  "report",
  "thesis",
  "book",
  "webpage"
];

// src/client.tsx
var ReactDOM = require("react-dom");
var REGISTRANT = "dsh-refkeeper";
var inject = ["slots"];
var INITIAL = {
  open: false,
  scope: "turn",
  turns: 3,
  bibtex: true,
  ris: true,
  cslJson: false
};
var state = INITIAL;
var listeners = /* @__PURE__ */ new Set();
function setState(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function usePanelState() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => INITIAL
  );
}
var localeLookup;
function activeLocale() {
  try {
    return localeLookup?.()?.getSnapshot().active;
  } catch {
    return void 0;
  }
}
function useStrings() {
  const subscribe = React.useCallback((onChange) => {
    let locale;
    try {
      locale = localeLookup?.();
    } catch {
      return () => {
      };
    }
    return locale === void 0 ? () => {
    } : locale.subscribe(onChange);
  }, []);
  const tag = React.useSyncExternalStore(
    subscribe,
    () => activeLocale() ?? (typeof document === "undefined" ? "en" : document.documentElement.lang),
    () => "en"
  );
  return stringsFor(tag);
}
var sessionsLookup;
function sessionsNow() {
  if (sessionsLookup === void 0) return void 0;
  try {
    return sessionsLookup();
  } catch {
    return void 0;
  }
}
function commandTexts(sessionId) {
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return [];
  const texts = [];
  for (const entry of source.getSnapshot().entries) {
    const item = entry;
    if (item.type !== "event" || item.event?.type !== "command/done") continue;
    const text = item.event.data?.text;
    if (typeof text === "string" && text.includes(BATCH_MARKER)) texts.push(text);
  }
  return texts;
}
function latestBatchOf(texts) {
  let best;
  for (const text of texts) {
    const batch = decodeBatch(text);
    if (batch === void 0) continue;
    if (best === void 0 || batch.capturedAt >= best.capturedAt) best = batch;
  }
  return best;
}
var batchCache = /* @__PURE__ */ new Map();
function snapshotBatch(sessionId, nonce) {
  if (sessionId === void 0) return void 0;
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return void 0;
  const window2 = source.getSnapshot();
  const key = `${String(nonce)}:${String(window2.revision)}:${String(window2.entries.length)}`;
  const cached = batchCache.get(sessionId);
  if (cached !== void 0 && cached.key === key) return cached.batch;
  const batch = latestBatchOf(commandTexts(sessionId));
  batchCache.set(sessionId, { key, batch });
  return batch;
}
function subscribeBatch(sessionId, listener) {
  if (sessionId === void 0) return () => {
  };
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source !== void 0) return source.subscribe(listener);
  const timer = setInterval(listener, 1e3);
  return () => clearInterval(timer);
}
function useLatestBatch(sessionId, nonce = 0) {
  return React.useSyncExternalStore(
    (listener) => subscribeBatch(sessionId, listener),
    () => snapshotBatch(sessionId, nonce),
    () => void 0
  );
}
function latestDirOf(sessionId) {
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return void 0;
  let found;
  for (const entry of source.getSnapshot().entries) {
    const item = entry;
    if (item.type !== "event" || item.event?.type !== "command/done") continue;
    const text = item.event.data?.text;
    if (typeof text !== "string") continue;
    const decoded = decodeDir(text);
    if (decoded !== void 0) found = decoded;
  }
  return found;
}
var dirCache = /* @__PURE__ */ new Map();
function snapshotDir(sessionId, nonce) {
  if (sessionId === void 0) return void 0;
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return void 0;
  const window2 = source.getSnapshot();
  const key = `${String(nonce)}:${String(window2.revision)}:${String(window2.entries.length)}`;
  const cached = dirCache.get(sessionId);
  if (cached !== void 0 && cached.key === key) return cached.dir;
  const dir = latestDirOf(sessionId);
  dirCache.set(sessionId, { key, dir });
  return dir;
}
function useLatestDir(sessionId, nonce = 0) {
  return React.useSyncExternalStore(
    (listener) => subscribeBatch(sessionId, listener),
    () => snapshotDir(sessionId, nonce),
    () => void 0
  );
}
var registrySettingsCache = /* @__PURE__ */ new Map();
function latestRegistrySettingsOf(sessionId) {
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return void 0;
  let found;
  source.getSnapshot().entries.forEach((entry, index) => {
    const item = entry;
    if (item.type !== "event" || item.event?.type !== "command/done") return;
    const text = item.event.data?.text;
    if (typeof text !== "string") return;
    const snapshot = decodeRegistrySettings(text);
    if (snapshot !== void 0) found = { index, snapshot };
  });
  return found;
}
function snapshotRegistrySettings(sessionId, nonce) {
  if (sessionId === void 0) return void 0;
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source === void 0) return void 0;
  const window2 = source.getSnapshot();
  const key = `${String(nonce)}:${String(window2.revision)}:${String(window2.entries.length)}`;
  const cached = registrySettingsCache.get(sessionId);
  if (cached !== void 0 && cached.key === key) return cached.value;
  const latest = latestRegistrySettingsOf(sessionId);
  const value = {
    size: window2.entries.length,
    markerIndex: latest?.index ?? -1,
    snapshot: latest?.snapshot
  };
  registrySettingsCache.set(sessionId, { key, value });
  return value;
}
function useLatestRegistrySettings(sessionId, nonce = 0) {
  return React.useSyncExternalStore(
    (listener) => subscribeBatch(sessionId, listener),
    () => snapshotRegistrySettings(sessionId, nonce),
    () => void 0
  );
}
var INITIAL_REGISTRY_SETTINGS = {
  registryBaseUrls: DEFAULT_REGISTRY_BASE_URLS,
  mailto: "",
  privateMode: false
};
var REGISTRY_LABELS = {
  crossref: (text) => text.registryCrossref,
  datacite: (text) => text.registryDatacite,
  openalex: (text) => text.registryOpenalex,
  arxiv: (text) => text.registryArxiv,
  pubmed: (text) => text.registryPubmed,
  openlibrary: (text) => text.registryOpenlibrary
};
var STATUS_TONE = {
  saved: UI_TOKENS.color.success,
  quarantined: UI_TOKENS.color.warning,
  skipped: UI_TOKENS.color.neutral,
  failed: UI_TOKENS.color.error
};
function statusLabel(entry, text) {
  if (entry.status === "saved") return text.statusSaved;
  if (entry.status === "quarantined") return text.statusQuarantined;
  if (entry.status === "skipped") return text.statusSkipped;
  return text.statusFailed;
}
function entryMeta(entry, text) {
  const authors = entry.fields?.authors ?? [];
  const author = authors.length === 1 ? authors[0] : authors.length === 2 ? `${authors[0]} ${text.authorConjunction} ${authors[1]}` : authors.length > 2 ? `${authors[0]} et al.` : "";
  return [author, entry.fields?.year === void 0 ? "" : String(entry.fields.year), entry.fields?.containerTitle ?? "", entryReasonForMeta(entry.status, entry.reason) ?? ""].filter((part) => typeof part === "string" && part.trim() !== "").join(" \xB7 ");
}
var FIELDS = [
  { key: "type", label: (text) => text.fieldType },
  { key: "title", label: (text) => text.fieldTitle, multiline: true },
  // The authors hint is part of the visible label, not a placeholder, so the
  // expected format stays readable after the field is filled. It is laid out on
  // its own line to keep the label within the 340px dock's label column.
  { key: "authors", label: (text) => `${text.fieldAuthors}
${text.fieldAuthorsHint}`, multiline: true },
  { key: "containerTitle", label: (text) => text.fieldContainer },
  { key: "year", label: (text) => text.fieldYear, numeric: true },
  { key: "volume", label: (text) => text.fieldVolume },
  { key: "issue", label: (text) => text.fieldIssue },
  { key: "pages", label: (text) => text.fieldPages },
  { key: "publisher", label: (text) => text.fieldPublisher },
  { key: "publisherPlace", label: (text) => text.fieldPlace },
  { key: "language", label: (text) => text.fieldLanguage },
  { key: "doi", label: (text) => text.fieldDoi },
  { key: "arxivId", label: (text) => text.fieldArxiv },
  { key: "pmid", label: (text) => text.fieldPmid },
  { key: "pmcid", label: (text) => text.fieldPmcid },
  { key: "isbn", label: (text) => text.fieldIsbn },
  { key: "reportNumber", label: (text) => text.fieldReportNumber },
  { key: "lccn", label: (text) => text.fieldLccn },
  { key: "oclc", label: (text) => text.fieldOclc },
  { key: "openlibraryId", label: (text) => text.fieldOpenlibraryId },
  { key: "url", label: (text) => text.fieldUrl }
];
function draftOf(entry) {
  const fields = entry.fields;
  const base = {
    type: fields?.type ?? "journalArticle",
    title: fields?.title ?? entry.title,
    authors: (fields?.authors ?? []).join("\n"),
    containerTitle: fields?.containerTitle ?? "",
    year: fields?.year === void 0 ? "" : String(fields.year),
    volume: fields?.volume ?? "",
    issue: fields?.issue ?? "",
    pages: fields?.pages ?? "",
    publisher: fields?.publisher ?? "",
    publisherPlace: fields?.publisherPlace ?? "",
    language: fields?.language ?? "",
    doi: fields?.doi ?? entry.doi ?? "",
    arxivId: fields?.arxivId ?? entry.arxivId ?? "",
    pmid: fields?.pmid ?? entry.pmid ?? "",
    pmcid: fields?.pmcid ?? entry.pmcid ?? "",
    isbn: fields?.isbn ?? "",
    reportNumber: fields?.reportNumber ?? "",
    lccn: fields?.lccn ?? "",
    oclc: fields?.oclc ?? "",
    openlibraryId: fields?.openlibraryId ?? "",
    url: fields?.url ?? ""
  };
  return base;
}
function patchOf(entry, draft) {
  const base = draftOf(entry);
  const patch = {};
  for (const field of FIELDS) {
    const value = (draft[field.key] ?? "").trim();
    const before = (base[field.key] ?? "").trim();
    if (value === before) continue;
    if (field.key === "authors") {
      patch["authors"] = parseAuthorLines(value);
      continue;
    }
    if (field.key === "year") {
      const year = Number(value);
      if (value !== "" && Number.isFinite(year)) patch["year"] = year;
      continue;
    }
    if (field.key === "type") {
      if (value !== "") patch["type"] = value;
      continue;
    }
    if (field.key === "title") {
      if (value !== "") patch["title"] = value;
      continue;
    }
    patch[field.key] = value;
  }
  return patch;
}
var EMPTY_COMMAND_SNAPSHOT = '{"revision":0,"size":0,"runs":[],"commands":[]}';
function commandSnapshotOf(sessionId, cache) {
  if (sessionId === void 0) {
    cache.current = void 0;
    return EMPTY_COMMAND_SNAPSHOT;
  }
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  const snapshot = source?.getSnapshot();
  if (snapshot === void 0) {
    cache.current = void 0;
    return EMPTY_COMMAND_SNAPSHOT;
  }
  return cachedCommandSnapshot(cache, sessionId, snapshot.revision, snapshot.entries.length, () => {
    const runs = [];
    const commands = [];
    snapshot.entries.forEach((item, index) => {
      const event = item;
      if (event.type !== "event") return;
      const data = event.event?.data;
      if (typeof data !== "object" || data === null) return;
      const command = data;
      if (typeof command.commandId !== "string") return;
      if (event.event?.type === "command/run") {
        if (typeof command.name !== "string") return;
        runs.push({
          index,
          commandId: command.commandId,
          name: command.name,
          ...typeof command.args === "string" ? { args: command.args } : {}
        });
        return;
      }
      if (event.event?.type !== "command/done" || command.kind !== "success" && command.kind !== "error") return;
      commands.push({
        index,
        commandId: command.commandId,
        kind: command.kind,
        ...typeof command.text === "string" ? { text: command.text } : {}
      });
    });
    return JSON.stringify({ revision: snapshot.revision, size: snapshot.entries.length, runs, commands });
  });
}
function subscribeCommandEvents(sessionId, listener) {
  if (sessionId === void 0) return () => void 0;
  const source = sessionsNow()?.binding(sessionId)?.eventSource;
  if (source !== void 0) return source.subscribe(listener);
  const timer = setInterval(listener, 1e3);
  return () => clearInterval(timer);
}
function useCommandEvents(sessionId) {
  const cache = React.useRef({ current: void 0 });
  const raw = React.useSyncExternalStore(
    (listener) => subscribeCommandEvents(sessionId, listener),
    () => commandSnapshotOf(sessionId, cache.current),
    () => EMPTY_COMMAND_SNAPSHOT
  );
  return React.useMemo(() => JSON.parse(raw), [raw]);
}
function createDraftOf(entry) {
  const draft = draftOf(entry);
  if (entry.fields?.title !== void 0) return draft;
  const title = entry.title.trim();
  if (title === entry.doi || title === entry.arxivId || title === "\u2014") draft.title = "";
  return draft;
}
function entryWithManualResult(entry, payload, result) {
  const base = entry.fields ?? { type: "journalArticle", title: entry.title, authors: [] };
  const title = typeof payload["title"] === "string" ? payload["title"] : base.title;
  const type = typeof payload["type"] === "string" ? payload["type"] : base.type;
  const authors = Array.isArray(payload["authors"]) ? payload["authors"].filter((author) => typeof author === "string") : base.authors;
  const fields = {
    ...base,
    ...payload,
    type,
    title,
    authors
  };
  return {
    ...entry,
    id: result.id,
    status: result.status,
    title,
    fields,
    ...typeof payload["year"] === "number" ? { year: payload["year"] } : {},
    ...typeof payload["doi"] === "string" && payload["doi"] !== "" ? { doi: payload["doi"] } : {},
    ...typeof payload["arxivId"] === "string" && payload["arxivId"] !== "" ? { arxivId: payload["arxivId"] } : {},
    ...typeof payload["pmid"] === "string" && payload["pmid"] !== "" ? { pmid: payload["pmid"] } : {},
    ...typeof payload["pmcid"] === "string" && payload["pmcid"] !== "" ? { pmcid: payload["pmcid"] } : {}
  };
}
function payloadFromDraft(draft) {
  const payload = {
    type: REF_TYPES.includes(draft["type"] ?? "") ? draft["type"] : "journalArticle",
    title: (draft["title"] ?? "").trim(),
    year: Number(draft["year"]),
    authors: parseAuthorLines(draft["authors"] ?? "")
  };
  for (const field of FIELDS) {
    if (field.key === "type" || field.key === "title" || field.key === "year" || field.key === "authors") continue;
    const value = (draft[field.key] ?? "").trim();
    if (value !== "") payload[field.key] = value;
  }
  return payload;
}
var ENTRY_DETAILS_FORM_ID = "dsh-refkeeper-entry-details-form";
function EntryDetails(props) {
  const { entry, rowKey, mode, text, onEdit, onManualSave, onPromote, manualOutcome, onTitleRef } = props;
  const [draft, setDraft] = React.useState(() => createDraftOf(entry));
  const [validationError, setValidationError] = React.useState(false);
  const [editNotice, setEditNotice] = React.useState(false);
  React.useEffect(() => {
    setDraft(createDraftOf(entry));
    setValidationError(false);
    setEditNotice(false);
  }, [entry]);
  const submit = (event) => {
    event.preventDefault();
    if (mode === "create") {
      const authors = parseAuthorLines(draft["authors"] ?? "");
      const year = Number(draft["year"]);
      const title = (draft["title"] ?? "").trim();
      if (title === "" || authors.length === 0 || !Number.isInteger(year)) {
        setValidationError(true);
        return;
      }
      const sent = onManualSave(entry, payloadFromDraft(draft));
      setValidationError(false);
      if (!sent) setEditNotice(true);
      return;
    }
    if (entry.id === void 0) return;
    const patch = patchOf(entry, draft);
    if (Object.keys(patch).length === 0) {
      setValidationError(false);
      setEditNotice(true);
      return;
    }
    onEdit(entry.id, patch, (draft["title"] ?? "").trim() || void 0);
    setValidationError(false);
    setEditNotice(true);
  };
  const outcomeText = manualOutcome === "pending" ? text.manualSavePending : manualOutcome === "saved" ? `${text.manualSaveConfirmed} ${text.manualSaveNextCapture}` : manualOutcome === "already" ? `${text.manualSaveAlready} ${text.manualSaveNextCapture}` : manualOutcome === "quarantined" ? `${text.manualSaveQuarantined} ${text.manualSaveNextCapture}` : manualOutcome === "unconfirmed" ? text.manualSaveUnconfirmed : editNotice ? mode === "edit" ? text.detailsSubmitted : text.unavailable : "";
  const outcomeTone = manualOutcome === "quarantined" ? UI_TOKENS.color.warning : manualOutcome === "unconfirmed" || editNotice ? UI_TOKENS.color.neutral : UI_TOKENS.color.success;
  const groupDefinitions = [
    { key: "identifiers", label: text.groupIdentifiers, fields: ["type", "doi", "arxivId", "pmid", "pmcid", "isbn", "reportNumber", "lccn", "oclc", "openlibraryId", "url"] },
    { key: "bibliography", label: text.groupBibliography, fields: ["title", "authors", "containerTitle", "pages", "language"] },
    { key: "publication", label: text.groupPublication, fields: ["year", "volume", "issue", "publisher", "publisherPlace"] }
  ];
  const reasonPrefix = "refkeeper-latest-verification-reasons:";
  const reason = entry.reason ?? "";
  const reasonText = reason.startsWith(reasonPrefix) ? `${text.latestVerificationReasons} ${reason.slice(reasonPrefix.length).trim()}` : reason;
  return React.createElement(
    "div",
    { style: { display: "grid", gap: UI_TOKENS.layout.sectionGap, minWidth: 0 } },
    entry.status === "quarantined" ? React.createElement("div", {
      role: "status",
      style: { padding: UI_TOKENS.spacing.sm, borderRadius: UI_TOKENS.radius.panel, color: UI_TOKENS.color.warning, background: "color-mix(in srgb, var(--dsw-alias-warning, #f59e0b) 14%, transparent)", fontSize: UI_TOKENS.fontSize.caption }
    }, `\u26A0 ${text.quarantineNotice}${reasonText ? ` ${reasonText}` : ""}`) : null,
    React.createElement(
      "form",
      {
        id: ENTRY_DETAILS_FORM_ID,
        onSubmit: submit,
        onReset: (event) => {
          event.preventDefault();
          setDraft(createDraftOf(entry));
          setValidationError(false);
          setEditNotice(false);
        },
        style: { display: "grid", gap: UI_TOKENS.layout.groupGap, minWidth: 0 }
      },
      ...groupDefinitions.map((group) => React.createElement(
        "section",
        { key: group.key, style: { display: "grid", gap: UI_TOKENS.layout.fieldGap, minWidth: 0 } },
        React.createElement("h3", { style: { margin: 0, paddingBottom: UI_TOKENS.spacing.xs, borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))", fontSize: UI_TOKENS.fontSize.control, fontWeight: 500 } }, group.label),
        ...FIELDS.filter((field) => group.fields.includes(field.key)).map((field) => {
          const value = draft[field.key] ?? "";
          const label = field.label(text);
          const onChange = (nextValue) => setDraft((current) => ({ ...current, [field.key]: nextValue }));
          let control;
          if (field.key === "type") {
            control = React.createElement("select", {
              value: value || "journalArticle",
              onChange: (event) => onChange(event.target.value),
              style: FIELD_STYLE
            }, ...REF_TYPES.map((type) => React.createElement("option", { key: type, value: type }, type)));
          } else if (field.multiline) {
            control = React.createElement("textarea", {
              ref: field.key === "title" ? onTitleRef : void 0,
              value,
              rows: field.key === "authors" ? 3 : 2,
              onChange: (event) => onChange(event.target.value),
              style: { ...FIELD_STYLE, resize: "vertical", minHeight: field.key === "authors" ? "68px" : "48px" }
            });
          } else {
            control = React.createElement("input", {
              type: field.numeric ? "number" : "text",
              min: field.numeric ? 0 : void 0,
              max: field.numeric ? 9999 : void 0,
              step: field.numeric ? 1 : void 0,
              value,
              onChange: (event) => onChange(event.target.value),
              style: FIELD_STYLE
            });
          }
          return React.createElement(
            "label",
            { key: field.key, style: { display: "grid", gap: UI_TOKENS.layout.labelGap, minWidth: 0, fontSize: UI_TOKENS.fontSize.caption } },
            React.createElement("span", { style: { whiteSpace: "pre-line", color: UI_TOKENS.color.neutral } }, label),
            control
          );
        })
      )),
      validationError ? React.createElement("div", { role: "alert", style: { color: UI_TOKENS.color.warning, fontSize: UI_TOKENS.fontSize.caption } }, text.manualSaveValidation) : null,
      outcomeText !== "" ? React.createElement("div", { role: "status", style: { color: outcomeTone, fontSize: UI_TOKENS.fontSize.caption } }, outcomeText) : null,
      entry.status === "quarantined" ? React.createElement(
        "div",
        { style: { display: "flex", gap: UI_TOKENS.layout.labelGap, flexWrap: "wrap" } },
        React.createElement("button", { type: "button", onClick: () => onPromote(entry, false), style: BASE_BUTTON }, text.promoteVerify),
        React.createElement("button", { type: "button", onClick: () => onPromote(entry, true), style: BASE_BUTTON }, text.promoteManual)
      ) : null
    )
  );
}
function PanelView(props) {
  const { view, onViewChange, batch, text, notice, sessionId, isPicked, onToggle, onEdit, onPromote, onManualSave, titleOf, pickedCount, onRefresh } = props;
  const [updatedRows, setUpdatedRows] = React.useState({ batchKey: "", rows: {} });
  const [pendingSave, setPendingSave] = React.useState(void 0);
  const [manualFeedback, setManualFeedback] = React.useState(void 0);
  const commands = useCommandEvents(sessionId);
  const listRef = React.useRef(null);
  const titleRef = React.useRef(null);
  const triggerRefs = React.useRef(/* @__PURE__ */ new Map());
  const restoreFocusKey = React.useRef(void 0);
  const restoreFocusOnList = React.useRef(false);
  const listScrollTop = React.useRef(0);
  const priorBatchKey = React.useRef("");
  const batchKey = batch === void 0 ? "" : `${batch.capturedAt}:${String(batch.entries.length)}`;
  const entries = batch === void 0 ? [] : batch.entries.map(
    (entry, index) => updatedRows.batchKey === batchKey ? updatedRows.rows[String(index)] ?? entry : entry
  );
  React.useEffect(() => {
    if (priorBatchKey.current === batchKey) return;
    priorBatchKey.current = batchKey;
    onViewChange({ kind: "list" });
    setUpdatedRows({ batchKey, rows: {} });
    setPendingSave(void 0);
    setManualFeedback(void 0);
  }, [batchKey, onViewChange]);
  React.useEffect(() => {
    if (pendingSave === void 0) return;
    if (pendingSave.commandId === void 0) {
      const run = commands.runs.find(
        (event) => event.index >= pendingSave.baselineSize && event.name === "refs" && event.args === pendingSave.expectedArgs
      );
      if (run === void 0) return;
      setPendingSave((current) => current === pendingSave ? { ...current, commandId: run.commandId } : current);
      return;
    }
    const done = commands.commands.find((event) => event.commandId === pendingSave.commandId);
    if (done === void 0) return;
    const result = done.kind === "success" && done.text !== void 0 ? parseManualSaveResult(done.text) : void 0;
    if (result === void 0) {
      setManualFeedback({ rowKey: pendingSave.rowKey, outcome: "unconfirmed" });
      setPendingSave(void 0);
      return;
    }
    if (pendingSave.batchKey === batchKey) {
      const next = entryWithManualResult(pendingSave.entry, pendingSave.payload, result);
      setUpdatedRows((current) => {
        const rows = current.batchKey === batchKey ? current.rows : {};
        return { batchKey, rows: { ...rows, [pendingSave.rowKey]: next } };
      });
    }
    setManualFeedback({ rowKey: pendingSave.rowKey, outcome: result.outcome });
    setPendingSave(void 0);
  }, [commands, pendingSave, batchKey]);
  const leaveDetail = () => {
    restoreFocusOnList.current = true;
    onViewChange({ kind: "list" });
  };
  React.useEffect(() => {
    if (view.kind === "detail") {
      const focusFrame = window.requestAnimationFrame(() => titleRef.current?.focus());
      const handleKeyDown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        leaveDetail();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.cancelAnimationFrame(focusFrame);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
    if (!restoreFocusOnList.current) return;
    restoreFocusOnList.current = false;
    const focusKey = restoreFocusKey.current;
    const frame = window.requestAnimationFrame(() => {
      if (focusKey !== void 0) triggerRefs.current.get(focusKey)?.focus();
      if (listRef.current !== null) listRef.current.scrollTop = listScrollTop.current;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);
  const openDetail = (entry, index, mode, trigger) => {
    const rowKey = String(index);
    restoreFocusKey.current = `${rowKey}:${trigger}`;
    listScrollTop.current = listRef.current?.scrollTop ?? 0;
    onViewChange({ kind: "detail", id: rowKey, mode });
  };
  const submitManual = (entry, payload, rowKey) => {
    if (pendingSave !== void 0) return false;
    const baselineSize = commands.size;
    const expectedArgs = manualSaveCommand(payload).slice("/refs".length);
    const submitted = onManualSave(entry, payload);
    if (!submitted) {
      setManualFeedback({ rowKey, outcome: "unconfirmed" });
      return false;
    }
    setPendingSave({ rowKey, baselineSize, expectedArgs, batchKey, entry, payload });
    setManualFeedback({ rowKey, outcome: "pending" });
    return true;
  };
  if (view.kind === "detail") {
    const index = Number(view.id);
    const entry = entries[index];
    if (entry === void 0) {
      return React.createElement("button", { type: "button", onClick: leaveDetail, style: BASE_BUTTON }, text.detailBack);
    }
    const rowKey = String(index);
    const title = titleOf(entry) === "" ? entry.doi ?? entry.arxivId ?? "\u2014" : titleOf(entry);
    const feedback = manualFeedback?.rowKey === rowKey ? manualFeedback.outcome : pendingSave?.rowKey === rowKey ? "pending" : void 0;
    return React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, minWidth: 0 } },
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: UI_TOKENS.layout.labelGap, minWidth: 0, flexShrink: 0 } },
        React.createElement("button", { type: "button", onClick: leaveDetail, style: { ...BASE_BUTTON, flexShrink: 0 } }, `\u2190 ${text.detailBack}`),
        React.createElement("strong", { style: { fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, view.mode === "create" ? text.detailCreate : text.detailEdit)
      ),
      React.createElement(
        "div",
        { style: { display: "grid", alignContent: "start", gap: UI_TOKENS.layout.sectionGap, flex: "1 1 auto", minHeight: 0, minWidth: 0, overflowY: "auto" } },
        React.createElement("div", { title, style: { fontSize: UI_TOKENS.fontSize.control, fontWeight: 500, overflowWrap: "anywhere" } }, title),
        React.createElement("div", { style: { fontSize: UI_TOKENS.fontSize.caption, color: UI_TOKENS.color.neutral } }, entryMeta(entry, text)),
        React.createElement(EntryDetails, {
          key: `${rowKey}:${view.mode}`,
          entry,
          rowKey,
          mode: view.mode,
          text,
          onEdit,
          onManualSave: (currentEntry, payload) => submitManual(currentEntry, payload, rowKey),
          onPromote,
          manualOutcome: feedback,
          onTitleRef: (element) => {
            titleRef.current = element;
          }
        })
      ),
      notice !== "" ? React.createElement("div", { style: { marginTop: "6px", color: UI_TOKENS.color.warning, flexShrink: 0 } }, notice) : null,
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: UI_TOKENS.layout.labelGap, flexWrap: "wrap", flexShrink: 0, paddingTop: UI_TOKENS.spacing.xs, borderTop: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))" } },
        React.createElement("button", {
          type: "submit",
          form: ENTRY_DETAILS_FORM_ID,
          disabled: view.mode === "create" && (feedback === "pending" || pendingSave !== void 0),
          style: BASE_BUTTON
        }, view.mode === "create" ? text.manualSave : text.detailsSave),
        React.createElement("button", { type: "reset", form: ENTRY_DETAILS_FORM_ID, style: BASE_BUTTON }, text.detailsReset)
      )
    );
  }
  const savedCount = batch?.entries.filter((entry) => entry.status === "saved").length ?? 0;
  if (batch === void 0) {
    return React.createElement(
      "div",
      { style: { marginTop: UI_TOKENS.spacing.md, padding: `${UI_TOKENS.spacing.lg} ${UI_TOKENS.spacing.md}`, textAlign: "center", border: "1px dashed var(--dsw-alias-border-l1, rgba(128,128,128,.35))", borderRadius: UI_TOKENS.radius.panel, background: "var(--dsw-alias-bg-l1, rgba(128,128,128,.04))", color: "var(--dsw-alias-label-tertiary, inherit)" } },
      React.createElement("div", { "aria-hidden": true, style: { fontSize: "22px", marginBottom: UI_TOKENS.spacing.xs } }, "\u2315"),
      React.createElement("div", { style: { fontSize: "13px", fontWeight: 500 } }, text.batchEmpty)
    );
  }
  return React.createElement(
    "div",
    { ref: listRef, style: { marginTop: UI_TOKENS.spacing.md, display: "grid", gap: UI_TOKENS.spacing.sm, minWidth: 0, flex: "1 1 auto", minHeight: 0, overflowY: "auto" } },
    savedCount > 0 ? React.createElement("div", { style: { color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.82))", fontSize: UI_TOKENS.fontSize.caption, flexShrink: 0 } }, text.storedNotice.replace("{n}", String(savedCount))) : null,
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, justifyContent: "space-between", gap: UI_TOKENS.spacing.sm } },
      React.createElement("span", { style: { fontWeight: 500 } }, `${text.batchHeading} \xB7 ${String(entries.length)}`),
      React.createElement(
        "div",
        { style: { ...ROW_STYLE, flexShrink: 0 } },
        React.createElement("span", { style: { opacity: 0.7, fontSize: UI_TOKENS.fontSize.caption } }, batch.scope),
        React.createElement("button", { type: "button", onClick: onRefresh, style: { ...BASE_BUTTON, padding: "3px 7px" } }, text.refresh)
      )
    ),
    batch.truncated === true ? React.createElement("div", { role: "status", style: { fontSize: UI_TOKENS.fontSize.caption, color: UI_TOKENS.color.warning } }, text.captureTruncated.replace("{chars}", String(batch.chars ?? 0))) : null,
    React.createElement("div", { style: { fontSize: UI_TOKENS.fontSize.caption, color: UI_TOKENS.color.neutral } }, text.selectedCount.replace("{n}", String(pickedCount))),
    ...entries.map((entry, index) => {
      const rowKey = String(index);
      const title = titleOf(entry) === "" ? entry.doi ?? entry.arxivId ?? "\u2014" : titleOf(entry);
      const meta = entryMeta(entry, text);
      return React.createElement(
        "div",
        {
          key: rowKey,
          style: { border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))", borderRadius: UI_TOKENS.radius.panel, padding: `${UI_TOKENS.spacing.sm} ${UI_TOKENS.spacing.sm}`, background: "var(--dsw-alias-bg-l1, rgba(128,128,128,.035))", minWidth: 0 }
        },
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, gap: UI_TOKENS.spacing.xs, flexWrap: "nowrap", minWidth: 0 } },
          entry.id === void 0 ? React.createElement("span", { style: { width: "13px", flexShrink: 0 } }) : React.createElement("input", { type: "checkbox", checked: isPicked(entry), title: text.exportSelection, onChange: (event) => onToggle(entry.id, event.target.checked), style: { flexShrink: 0, margin: 0 } }),
          React.createElement("span", { style: { color: STATUS_TONE[entry.status], flexShrink: 0, whiteSpace: "nowrap", padding: "2px 7px", borderRadius: "999px", background: `color-mix(in srgb, ${STATUS_TONE[entry.status]} 14%, transparent)`, fontSize: UI_TOKENS.fontSize.caption } }, statusLabel(entry, text)),
          entry.annotated === true ? React.createElement("span", { title: text.annotated, style: { flexShrink: 0, opacity: 0.65 } }, "\u270E") : null,
          React.createElement("button", {
            type: "button",
            ref: (element) => {
              const key = `${rowKey}:title`;
              if (element === null) triggerRefs.current.delete(key);
              else triggerRefs.current.set(key, element);
            },
            onClick: () => openDetail(entry, index, entry.id === void 0 ? "create" : "edit", "title"),
            style: { flex: "1 1 auto", minWidth: 0, border: "none", background: "transparent", color: "inherit", font: "inherit", textAlign: "left", padding: 0, cursor: "pointer" },
            title
          }, React.createElement("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, title)),
          entry.status === "skipped" ? React.createElement("button", {
            type: "button",
            ref: (element) => {
              const key = `${rowKey}:manual`;
              if (element === null) triggerRefs.current.delete(key);
              else triggerRefs.current.set(key, element);
            },
            onClick: () => openDetail(entry, index, "create", "manual"),
            style: { ...BASE_BUTTON, flexShrink: 0, padding: "3px 7px" }
          }, text.manualOpen) : null
        ),
        meta === "" ? null : React.createElement("div", { title: meta, style: { margin: `${UI_TOKENS.spacing.xs} 0 0 20px`, fontSize: UI_TOKENS.fontSize.caption, lineHeight: 1.4, color: "var(--dsw-alias-label-secondary, rgba(128,128,128,.82))", overflowWrap: "anywhere" } }, meta)
      );
    })
  );
}
function manualSaveCommand(payload) {
  return `/refs save ${encodeFlag("payload", payload)}`;
}
function dispatch(actions, line) {
  if (actions === void 0) return false;
  actions.setDraft(line);
  setTimeout(() => {
    actions.submit();
  }, 60);
  return true;
}
function captureLine(current, save = true) {
  const suffix = save ? " --save" : "";
  if (current.scope === "all") return `/refs capture --scope=all${suffix}`;
  if (current.scope === "lastN") return `/refs capture --scope=lastN --turns=${String(current.turns)}${suffix}`;
  return `/refs capture --scope=turn${suffix}`;
}
function formatFlag(current) {
  if (current.cslJson) return "--format=csl-json";
  if (current.bibtex && current.ris) return "--format=both";
  if (current.bibtex) return "--format=bibtex";
  if (current.ris) return "--format=ris";
  return "";
}
function exportLine(current, extra = "") {
  const parts = [formatFlag(current), extra].filter((part) => part !== "");
  return `/refs export ${parts.join(" ")}`;
}
var BASE_BUTTON = {
  display: "inline-flex",
  alignItems: "center",
  gap: UI_TOKENS.spacing.xs,
  height: "28px",
  padding: "0 8px",
  borderRadius: UI_TOKENS.radius.control,
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: UI_TOKENS.fontSize.control,
  cursor: "pointer"
};
var PANEL_STYLE = {
  // Rendered from the composer dock, but pinned to the right edge so the long
  // annotation form never pushes the composer or covers the transcript.
  position: "fixed",
  right: "24px",
  top: "84px",
  zIndex: 60,
  width: "420px",
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "calc(100vh - 140px)",
  display: "flex",
  flexDirection: "column",
  overflowY: "hidden",
  minWidth: 0,
  boxSizing: "border-box",
  margin: 0,
  padding: "12px 14px",
  border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))",
  borderRadius: "10px",
  background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.06))",
  backdropFilter: "blur(10px)",
  boxShadow: "0 8px 28px rgba(0,0,0,.16)",
  color: "inherit",
  fontSize: "12px",
  lineHeight: 1.5
};
var FIELD_STYLE = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: `${UI_TOKENS.spacing.xs} ${UI_TOKENS.spacing.sm}`,
  borderRadius: UI_TOKENS.radius.control,
  border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))",
  background: "var(--dsw-alias-bg-l1, transparent)",
  color: "inherit",
  font: "inherit",
  fontSize: UI_TOKENS.fontSize.control
};
var ROW_STYLE = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" };
function CaptureButton() {
  const current = usePanelState();
  const text = useStrings();
  return React.createElement(
    "button",
    {
      type: "button",
      title: text.buttonTitle,
      "aria-label": "dsh-refkeeper capture",
      "aria-expanded": current.open,
      onClick: () => setState({ open: !current.open }),
      style: {
        ...BASE_BUTTON,
        color: current.open ? "var(--dsw-alias-brand-primary, #1f6feb)" : "inherit"
      }
    },
    React.createElement("span", { "aria-hidden": true }, "\u275D"),
    text.button
  );
}
function CapturePanel(props) {
  const current = usePanelState();
  const text = useStrings();
  const [notice, setNotice] = React.useState("");
  const [nonce, setNonce] = React.useState(0);
  const batch = useLatestBatch(props.sessionId, nonce);
  const dir = useLatestDir(props.sessionId, nonce);
  const latestRegistrySettings = useLatestRegistrySettings(props.sessionId, nonce);
  const [registrySettingsDraft, setRegistrySettingsDraft] = React.useState(INITIAL_REGISTRY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsRequest, setSettingsRequest] = React.useState(void 0);
  const [settingsMarkerSeen, setSettingsMarkerSeen] = React.useState("");
  const [settingsMessage, setSettingsMessage] = React.useState("");
  const rememberedDir = dir === void 0 || dir.dir === null ? "" : dir.dir;
  const [dirDraft, setDirDraft] = React.useState(rememberedDir);
  const [dirSeed, setDirSeed] = React.useState(rememberedDir);
  if (dirSeed !== rememberedDir) {
    setDirSeed(rememberedDir);
    setDirDraft(rememberedDir);
  }
  const batchKey = batch === void 0 ? "" : `${batch.capturedAt}:${String(batch.entries.length)}`;
  const [view, setView] = React.useState({ kind: "list" });
  React.useEffect(() => {
    if (!current.open) setView({ kind: "list" });
  }, [current.open]);
  React.useEffect(() => {
    const settingsWindow = latestRegistrySettings;
    if (settingsWindow?.snapshot === void 0) return;
    const snapshot = settingsWindow.snapshot;
    const markerKey = `${String(settingsWindow.markerIndex)}:${JSON.stringify(snapshot)}`;
    if (markerKey === settingsMarkerSeen) return;
    setSettingsMarkerSeen(markerKey);
    setRegistrySettingsDraft(snapshot.settings);
    if (settingsRequest !== void 0 && settingsWindow.markerIndex >= settingsRequest.baselineSize) {
      setSettingsRequest(void 0);
      setSettingsMessage(snapshot.warnings.length > 0 ? text.registrySettingsWarnings : settingsRequest.action === "save" ? text.registrySettingsSaved : "");
    } else if (settingsRequest === void 0) {
      setSettingsMessage(snapshot.warnings.length > 0 ? text.registrySettingsWarnings : "");
    }
  }, [latestRegistrySettings, settingsMarkerSeen, settingsRequest, text]);
  const [ticks, setTicks] = React.useState({
    key: "",
    picked: {}
  });
  const current_ticks = ticks.key === batchKey ? ticks.picked : void 0;
  const isPicked = (entry) => current_ticks?.[entry.id ?? ""] ?? entry.status === "saved";
  const pickedIds = batch === void 0 ? [] : batch.entries.filter((entry) => entry.id !== void 0 && isPicked(entry)).map((entry) => entry.id);
  const onToggle = (id, next) => {
    setTicks((previous) => {
      if (previous.key === batchKey) return { key: previous.key, picked: { ...previous.picked, [id]: next } };
      const seeded = {};
      for (const entry of batch?.entries ?? []) {
        if (entry.id !== void 0) seeded[entry.id] = entry.status === "saved";
      }
      seeded[id] = next;
      return { key: batchKey, picked: seeded };
    });
  };
  const selectionFlag = pickedIds.length === 0 ? "" : encodeFlag("ids", pickedIds);
  const [edits, setEdits] = React.useState({
    key: "",
    titles: {}
  });
  const titleOverrides = edits.key === batchKey ? edits.titles : {};
  const titleOf = (entry) => entry.id === void 0 ? entry.title : titleOverrides[entry.id] ?? entry.title;
  const onEdit = (id, patch, title) => {
    run(`/refs edit ${encodeFlag("ids", [id])} ${encodeFlag("payload", patch)}`);
    if (title === void 0) return;
    setEdits((previous) => {
      const titles = previous.key === batchKey ? previous.titles : {};
      return { key: batchKey, titles: { ...titles, [id]: title } };
    });
  };
  const onPromote = (entry, manual) => {
    if (entry.id === void 0) return;
    const parts = [encodeFlag("ids", [entry.id])];
    if (manual) parts.push("--manual", encodeFlag("reason", `panel confirmation ${(/* @__PURE__ */ new Date()).toISOString()}`));
    run(`/refs promote ${parts.join(" ")}`);
  };
  if (!current.open) return null;
  const run = (line) => {
    setNotice(dispatch(props.inputActions, line) ? "" : text.unavailable);
  };
  const formatOption = (key, label) => React.createElement(
    "label",
    { key, style: { ...ROW_STYLE, gap: "4px", cursor: "pointer" } },
    React.createElement("input", {
      type: "checkbox",
      checked: current[key],
      onChange: (event) => {
        const checked = event.target.checked;
        if (key === "cslJson") {
          setState(checked ? { cslJson: true, bibtex: false, ris: false } : { cslJson: false });
          return;
        }
        setState(checked ? { [key]: true, cslJson: false } : { [key]: false });
      }
    }),
    label
  );
  const canExport = current.bibtex || current.ris || current.cslJson;
  const exportStyle = () => ({
    ...BASE_BUTTON,
    opacity: canExport ? 1 : 0.5,
    cursor: canExport ? "pointer" : "not-allowed"
  });
  const scopeOption = (value, label) => React.createElement(
    "label",
    { key: value, style: { ...ROW_STYLE, gap: "4px", cursor: "pointer" } },
    React.createElement("input", {
      type: "radio",
      name: "refkeeper-scope",
      checked: current.scope === value,
      onChange: () => setState({ scope: value })
    }),
    label
  );
  const submitRegistrySettings = (action) => {
    const baselineSize = latestRegistrySettings?.size ?? 0;
    const command = action === "load" ? "/refs settings" : `/refs settings ${encodeFlag("payload", registrySettingsDraft)}`;
    if (!dispatch(props.inputActions, command)) {
      setSettingsRequest(void 0);
      setSettingsMessage(text.registrySettingsUnavailable);
      return;
    }
    setSettingsRequest({ baselineSize, action });
    setSettingsMessage(text.registrySettingsLoading);
  };
  const registrySnapshot = latestRegistrySettings?.snapshot;
  const settingsDisabled = settingsRequest !== void 0 || registrySnapshot === void 0;
  const settingsFields = REGISTRY_IDS.map((id) => {
    const custom = registrySnapshot?.customRegistryIds.includes(id) ?? false;
    return React.createElement(
      "label",
      { key: id, style: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 } },
      React.createElement(
        "span",
        { style: { ...ROW_STYLE, justifyContent: "space-between", gap: "6px" } },
        REGISTRY_LABELS[id](text),
        React.createElement("span", { style: { opacity: 0.65, flexShrink: 0 } }, registrySnapshot === void 0 ? text.registrySettingsLoading : custom ? text.registryCustomStatus : text.registryDefaultStatus)
      ),
      React.createElement("input", {
        type: "url",
        value: registrySettingsDraft.registryBaseUrls[id],
        disabled: settingsDisabled,
        spellCheck: false,
        "aria-label": REGISTRY_LABELS[id](text),
        onChange: (event) => {
          const value = event.target.value;
          setRegistrySettingsDraft((previous) => ({
            ...previous,
            registryBaseUrls: { ...previous.registryBaseUrls, [id]: value }
          }));
        },
        style: { ...FIELD_STYLE, width: "100%", boxSizing: "border-box" }
      })
    );
  });
  const registrySettingsPanel = React.createElement(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "8px", overflowY: "auto", minHeight: 0 } },
    React.createElement("div", { style: { fontSize: "12px", opacity: 0.75 } }, text.registrySettingsHint),
    ...settingsFields,
    React.createElement(
      "label",
      { style: { display: "flex", flexDirection: "column", gap: "3px" } },
      React.createElement("span", null, text.registryMailto),
      React.createElement("input", {
        type: "email",
        value: registrySettingsDraft.mailto,
        disabled: settingsDisabled,
        spellCheck: false,
        "aria-label": text.registryMailto,
        onChange: (event) => {
          const value = event.target.value;
          setRegistrySettingsDraft((previous) => ({ ...previous, mailto: value }));
        },
        style: { ...FIELD_STYLE, width: "100%", boxSizing: "border-box" }
      })
    ),
    React.createElement(
      "label",
      { style: { ...ROW_STYLE, alignItems: "flex-start", gap: "6px" } },
      React.createElement("input", {
        type: "checkbox",
        checked: registrySettingsDraft.privateMode,
        disabled: settingsDisabled,
        onChange: (event) => {
          const privateMode = event.target.checked;
          setRegistrySettingsDraft((previous) => ({ ...previous, privateMode }));
        }
      }),
      React.createElement(
        "span",
        null,
        React.createElement("strong", null, text.registryPrivateMode),
        React.createElement("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "3px" } }, text.registryPrivateModeHelp)
      )
    ),
    settingsMessage === "" ? null : React.createElement("div", { style: { color: settingsMessage === text.registrySettingsSaved ? UI_TOKENS.color.success : UI_TOKENS.color.warning } }, settingsMessage),
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, justifyContent: "flex-end", gap: "6px" } },
      React.createElement(
        "button",
        { type: "button", disabled: settingsRequest !== void 0, onClick: () => submitRegistrySettings("load"), style: { ...BASE_BUTTON, opacity: settingsRequest !== void 0 ? 0.6 : 1 } },
        text.registrySettingsReload
      ),
      React.createElement(
        "button",
        { type: "button", disabled: settingsDisabled, onClick: () => submitRegistrySettings("save"), style: { ...BASE_BUTTON, opacity: settingsDisabled ? 0.6 : 1 } },
        text.registrySettingsSave
      )
    )
  );
  return ReactDOM.createPortal(
    React.createElement(
      "section",
      {
        style: view.kind === "list" ? PANEL_STYLE : { ...PANEL_STYLE, display: "flex", flexDirection: "column", overflowY: "hidden" },
        "aria-label": "dsh-refkeeper panel"
      },
      view.kind === "list" ? React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, justifyContent: "space-between", flexShrink: 0 } },
          React.createElement("strong", null, `\u275D ${text.heading}`),
          React.createElement(
            "div",
            { style: { ...ROW_STYLE, gap: "4px", flexShrink: 0 } },
            React.createElement(
              "button",
              {
                type: "button",
                "aria-pressed": settingsOpen,
                onClick: () => {
                  const next = !settingsOpen;
                  setSettingsOpen(next);
                  if (next) submitRegistrySettings("load");
                },
                style: { ...BASE_BUTTON, height: "24px", padding: "0 6px" }
              },
              text.registrySettingsHeading
            ),
            React.createElement(
              "button",
              { type: "button", onClick: () => setState({ open: false }), style: { ...BASE_BUTTON, height: "24px", padding: "0 6px" } },
              text.close
            )
          )
        ),
        settingsOpen ? registrySettingsPanel : null,
        settingsOpen ? null : React.createElement(
          "div",
          { style: { ...ROW_STYLE, marginTop: "6px", flexShrink: 0 } },
          React.createElement("span", { style: { opacity: 0.7 } }, `${text.scopeLabel}:`),
          scopeOption("turn", text.scopeTurn),
          scopeOption("lastN", text.scopeLastN),
          current.scope === "lastN" ? React.createElement("input", {
            type: "number",
            min: 1,
            max: 500,
            value: current.turns,
            "aria-label": text.turnsLabel,
            onChange: (event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              setState({ turns: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1 });
            },
            style: { ...FIELD_STYLE, width: "64px" }
          }) : null,
          scopeOption("all", text.scopeAll)
        )
      ) : null,
      React.createElement(
        "div",
        { style: { display: settingsOpen ? "none" : "contents" } },
        React.createElement(PanelView, {
          view,
          onViewChange: setView,
          batch,
          text,
          notice,
          isPicked,
          onToggle,
          onEdit,
          onPromote,
          titleOf,
          pickedCount: pickedIds.length,
          onRefresh: () => setNonce((value) => value + 1),
          sessionId: props.sessionId,
          onManualSave: (_entry, payload) => {
            const submitted = dispatch(props.inputActions, manualSaveCommand(payload));
            setNotice(submitted ? "" : text.unavailable);
            return submitted;
          }
        })
      ),
      view.kind === "list" && !settingsOpen ? React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, marginTop: "4px", justifyContent: "space-between", gap: "8px", flexShrink: 0 } },
          React.createElement(
            "span",
            {
              title: rememberedDir === "" ? text.defaultDirUnset : rememberedDir,
              style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.75 }
            },
            `${text.defaultDirLabel}: ${rememberedDir === "" ? text.defaultDirUnset : rememberedDir}`
          )
        ),
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, marginTop: "4px", gap: "6px", flexWrap: "nowrap", flexShrink: 0 } },
          React.createElement("input", {
            type: "text",
            value: dirDraft,
            placeholder: text.dirPlaceholder,
            spellCheck: false,
            "aria-label": text.defaultDirLabel,
            onChange: (event) => {
              setDirDraft(event.target.value);
            },
            style: { ...FIELD_STYLE, flex: "1 1 auto", minWidth: 0 }
          }),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => run(`/refs dir ${encodeFlag("set", dirDraft.trim())}`),
              disabled: dirDraft.trim() === "",
              style: { ...BASE_BUTTON, flexShrink: 0, opacity: dirDraft.trim() === "" ? 0.5 : 1 }
            },
            text.dirSave
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => run("/refs dir --clear"), style: { ...BASE_BUTTON, flexShrink: 0 } },
            text.dirClearLabel
          )
        ),
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, marginTop: "4px", flexShrink: 0 } },
          React.createElement("span", { style: { opacity: 0.75 } }, `${text.formatLabel}:`),
          formatOption("bibtex", text.formatBibtex),
          formatOption("ris", text.formatRis),
          formatOption("cslJson", text.formatCslJson)
        ),
        React.createElement(
          "div",
          { style: { ...ROW_STYLE, marginTop: "8px", flexShrink: 0 } },
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => run(captureLine(current)),
              style: { ...BASE_BUTTON, borderColor: "var(--dsw-alias-brand-primary, #1f6feb)" }
            },
            `\u275D ${text.capture}`
          ),
          React.createElement(
            "button",
            { type: "button", disabled: !canExport, onClick: () => run(exportLine(current, selectionFlag)), style: exportStyle() },
            text.export
          ),
          React.createElement(
            "button",
            { type: "button", disabled: !canExport, onClick: () => run(exportLine(current, "--all")), style: exportStyle() },
            text.exportAll
          )
        ),
        notice === "" ? null : React.createElement("div", { style: { marginTop: "6px", color: UI_TOKENS.color.warning, flexShrink: 0 } }, notice)
      ) : null
    ),
    document.body
  );
}
function apply(ctx) {
  ctx.slots.inject(
    "conversation.input.left",
    () => ctx.slots.register(
      {
        name: "conversation.input.left",
        // `conversation.input.left` is a *list* slot: it identifies each entry
        // by `id` (a `key` is only for single/chain slots) and refuses the mount
        // otherwise — the failure surfaces as a thrown
        // `list slot ... requires options.id` in the browser console.
        id: "refkeeper-capture",
        order: 10,
        registrant: REGISTRANT
      },
      CaptureButton
    )
  );
  sessionsLookup = () => ctx.get("sessions");
  localeLookup = () => ctx.get("locale");
  ctx.slots.inject(
    "conversation.composer.dock",
    () => ctx.slots.register(
      { name: "conversation.composer.dock", id: "refkeeper-panel", order: 20, registrant: REGISTRANT },
      CapturePanel
    )
  );
}

return module.exports;
} });
