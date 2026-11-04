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
  return {
    capturedAt: typeof raw["capturedAt"] === "string" ? raw["capturedAt"] : "",
    scope: typeof raw["scope"] === "string" ? raw["scope"] : "",
    entries
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

// src/core/panel.ts
var DIR_MARKER = "refkeeper-dir:";
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

// src/ui/payload.ts
var BASE64URL = { "+": "-", "/": "_" };
function encodeFlag(name, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).replace(/[+/]/gu, (char) => BASE64URL[char] ?? char);
  return `--${name}=${base64.replace(/=+$/u, "")}`;
}

// src/client.tsx
var REGISTRANT = "dsh-refkeeper";
var inject = ["slots"];
var INITIAL = {
  open: false,
  scope: "turn",
  turns: 3,
  bibtex: true,
  ris: true
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
var EN = {
  button: "Refs",
  buttonTitle: "Capture references from this conversation",
  heading: "Capture references",
  scopeLabel: "Scope",
  scopeTurn: "This turn",
  scopeLastN: "Last N turns",
  scopeAll: "Whole conversation",
  turnsLabel: "Turns",
  includeTools: "Include tool outputs (noisy)",
  exportSelection: "Tick the references to export.",
  exportNone: "Nothing ticked: the whole last capture would be exported.",
  capture: "Capture & save",
  captureAndSave: "Capture & save",
  manualToggle: "Add / annotate manually",
  manualHint: "Takes the same `/refs save` path as the model: the entry is verified first and only stored when it passes.",
  title: "Title *",
  doi: "DOI",
  year: "Year",
  authors: "Authors (comma separated)",
  summary: "Summary",
  relevance: "Relevance to this work",
  evidence: "Evidence (quote or location)",
  caveats: "Caveats",
  save: "Verify & save",
  list: "Library",
  export: "Export this capture",
  exportAll: "Export all references",
  exportChooseDir: "Choose export folder\u2026",
  defaultDirLabel: "Folder",
  defaultDirUnset: "not set (refs/exports/)",
  dirPlaceholder: "Paste a folder path\u2026",
  dirSave: "Save folder",
  dirClearLabel: "Clear",
  formatLabel: "Formats",
  formatBibtex: "BibTeX",
  formatRis: "RIS",
  enrich: "Fill missing fields",
  batchHeading: "Last capture",
  batchEmpty: "Nothing captured yet \u2014 the export buttons then fall back to the whole library.",
  refresh: "Refresh list",
  annotated: "annotated",
  promoteVerify: "Re-verify",
  promoteManual: "Store as manual",
  statusSaved: "saved",
  statusQuarantined: "\u26A0 quarantined",
  statusSkipped: "skipped",
  statusFailed: "failed",
  close: "Close",
  needTitle: "A title is required before saving.",
  unavailable: "The composer is not ready yet; reopen the panel and retry.",
  detailsShow: "Details",
  detailsHide: "Hide",
  detailsSave: "Save changes",
  detailsSaved: "Saved. Exports now use these fields.",
  detailsStale: "This entry was captured before field snapshots existed, so only its title, year and id are known. Press \u201CFill missing fields\u201D (or capture again) to pull the full record from the registries.",
  detailsReset: "Revert",
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
  fieldUrl: "URL"
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
  includeTools: "\u5305\u542B\u5DE5\u5177\u8F93\u51FA\uFF08\u53EF\u80FD\u542B\u566A\u58F0\uFF09",
  exportSelection: "\u52FE\u9009\u9700\u8981\u5BFC\u51FA\u7684\u6587\u732E",
  exportNone: "\u6CA1\u6709\u52FE\u9009\u4EFB\u4F55\u6761\u76EE\uFF1A\u5C06\u5BFC\u51FA\u6574\u6279\u6B21\uFF08\u542B\u5DF2\u5165\u8868\u6761\u76EE\uFF09",
  capture: "\u6355\u83B7\u5E76\u4FDD\u5B58",
  captureAndSave: "\u6355\u83B7\u5E76\u4FDD\u5B58",
  manualToggle: "\u624B\u52A8\u6DFB\u52A0 / \u8865\u5145\u6CE8\u89E3",
  manualHint: "\u4E0E\u6A21\u578B\u8D70\u540C\u4E00\u6761 `/refs save`\uFF1A\u5148\u6821\u9A8C\uFF0C\u901A\u8FC7\u624D\u5165\u4E3B\u8868\uFF0C\u4E0D\u901A\u8FC7\u8FDB \u26A0 \u533A\u3002",
  title: "\u6807\u9898 *",
  doi: "DOI",
  year: "\u5E74\u4EFD",
  authors: "\u4F5C\u8005\uFF08\u9017\u53F7\u5206\u9694\uFF09",
  summary: "\u6458\u8981",
  relevance: "\u4E0E\u672C\u5DE5\u4F5C\u7684\u5173\u7CFB",
  evidence: "\u8BC1\u636E\uFF08\u539F\u8BDD\u6216\u4F4D\u7F6E\uFF09",
  caveats: "\u6CE8\u610F\u4E8B\u9879",
  save: "\u6821\u9A8C\u5E76\u4FDD\u5B58",
  list: "\u6587\u732E\u5E93",
  export: "\u5BFC\u51FA\u672C\u6B21\u6355\u83B7",
  exportAll: "\u5BFC\u51FA\u5168\u90E8\u6587\u732E",
  exportChooseDir: "\u9009\u62E9\u5BFC\u51FA\u76EE\u5F55\u2026",
  defaultDirLabel: "\u6587\u4EF6\u5939",
  defaultDirUnset: "\u672A\u8BBE\u7F6E\uFF08refs/exports/\uFF09",
  dirPlaceholder: "\u7C98\u8D34\u6587\u4EF6\u5939\u8DEF\u5F84\u2026",
  dirSave: "\u4FDD\u5B58\u6587\u4EF6\u5939",
  dirClearLabel: "\u6E05\u9664",
  formatLabel: "\u5BFC\u51FA\u683C\u5F0F",
  formatBibtex: "BibTeX",
  formatRis: "RIS",
  enrich: "\u8865\u5168\u7F3A\u5931\u5B57\u6BB5",
  batchHeading: "\u6700\u8FD1\u4E00\u6B21\u6355\u83B7",
  batchEmpty: "\u8FD8\u6CA1\u6709\u6355\u83B7\u8BB0\u5F55\uFF1B\u6B64\u65F6\u5BFC\u51FA\u4F1A\u9000\u56DE\u6574\u5E93\u3002",
  refresh: "\u5237\u65B0\u5217\u8868",
  annotated: "\u5DF2\u6CE8\u89E3",
  promoteVerify: "\u91CD\u65B0\u6838\u9A8C",
  promoteManual: "\u4EBA\u5DE5\u786E\u8BA4\u5165\u8868",
  statusSaved: "\u5DF2\u5165\u8868",
  statusQuarantined: "\u26A0 \u9694\u79BB",
  statusSkipped: "\u8DF3\u8FC7",
  statusFailed: "\u5931\u8D25",
  close: "\u5173\u95ED",
  needTitle: "\u4FDD\u5B58\u524D\u5FC5\u987B\u586B\u5199\u6807\u9898\u3002",
  unavailable: "\u8F93\u5165\u6846\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9762\u677F\u518D\u8BD5\u3002",
  detailsShow: "\u8BE6\u7EC6\u4FE1\u606F",
  detailsHide: "\u6536\u8D77",
  detailsSave: "\u4FDD\u5B58\u4FEE\u6539",
  detailsSaved: "\u5DF2\u4FDD\u5B58\uFF0C\u5BFC\u51FA\u5C06\u4F7F\u7528\u4FEE\u6539\u540E\u7684\u5B57\u6BB5\u3002",
  detailsStale: "\u8FD9\u6761\u662F\u8F83\u65E9\u6355\u83B7\u7559\u4E0B\u7684\uFF0C\u53EA\u5B58\u4E86\u6807\u9898\u3001\u5E74\u4EFD\u548C\u6807\u8BC6\uFF0C\u6CA1\u6709\u5B8C\u6574\u5B57\u6BB5\u3002\u70B9\u201C\u8865\u5168\u7F3A\u5931\u5B57\u6BB5\u201D\uFF08\u6216\u91CD\u65B0\u6355\u83B7\u4E00\u6B21\uFF09\u5373\u53EF\u4ECE Crossref / OpenAlex \u8865\u5168\u3002",
  detailsReset: "\u8FD8\u539F",
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
  fieldUrl: "URL"
};
var localeLookup;
function activeLocale() {
  try {
    return localeLookup?.()?.getSnapshot().active;
  } catch {
    return void 0;
  }
}
function stringsFor(tag) {
  return tag !== void 0 && tag.toLowerCase().startsWith("zh") ? ZH : EN;
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
  const window = source.getSnapshot();
  const key = `${String(nonce)}:${String(window.revision)}:${String(window.entries.length)}`;
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
  const window = source.getSnapshot();
  const key = `${String(nonce)}:${String(window.revision)}:${String(window.entries.length)}`;
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
var STATUS_TONE = {
  saved: "var(--dsw-alias-success, #1a7f37)",
  quarantined: "var(--dsw-alias-warn, #b26a00)",
  skipped: "var(--dsw-alias-fg-secondary, #6b7280)",
  failed: "var(--dsw-alias-danger, #b42318)"
};
function statusLabel(entry, text) {
  if (entry.status === "saved") return text.statusSaved;
  if (entry.status === "quarantined") return text.statusQuarantined;
  if (entry.status === "skipped") return text.statusSkipped;
  return text.statusFailed;
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
      patch["authors"] = value === "" ? [] : value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
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
function EntryDetails(props) {
  const { entry, text, onSave } = props;
  const [draft, setDraft] = React.useState(() => draftOf(entry));
  const [saved, setSaved] = React.useState(false);
  const editable = entry.id !== void 0;
  const change = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  return React.createElement(
    "div",
    { style: { display: "grid", gap: "4px", padding: "6px 0 8px 19px" } },
    entry.fields === void 0 && entry.id !== void 0 ? React.createElement(
      "div",
      { style: { opacity: 0.65, fontSize: "11px", lineHeight: 1.4 } },
      text.detailsStale
    ) : null,
    ...FIELDS.map(
      (field) => React.createElement(
        "label",
        {
          key: field.key,
          style: { display: "grid", gridTemplateColumns: "92px 1fr", gap: "6px", alignItems: "start" }
        },
        // 11px + a 92px column is what lets 「作者（每行一个）」 sit on one line and
        // its hint (“姓, 名”) on the next; pre-line honours the newline in the label.
        React.createElement(
          "span",
          { style: { opacity: 0.7, fontSize: "11px", lineHeight: "1.35", whiteSpace: "pre-line" } },
          field.label(text)
        ),
        React.createElement(field.multiline === true ? "textarea" : "input", {
          ...field.multiline === true ? { rows: field.key === "authors" ? 3 : 2 } : {},
          ...field.key === "authors" ? { placeholder: text.fieldAuthorsHint } : {},
          ...field.numeric === true ? { inputMode: "numeric" } : {},
          value: draft[field.key] ?? "",
          disabled: !editable,
          readOnly: !editable,
          style: { width: "100%", font: "inherit" },
          onChange: (event) => change(field.key, event.target.value)
        })
      )
    ),
    editable ? React.createElement(
      "div",
      { style: { ...ROW_STYLE, gap: "8px" } },
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            const patch = patchOf(entry, draft);
            if (Object.keys(patch).length === 0) return;
            const nextTitle = typeof patch["title"] === "string" ? patch["title"] : void 0;
            onSave(entry.id, patch, nextTitle);
            setSaved(true);
          }
        },
        text.detailsSave
      ),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setDraft(draftOf(entry));
            setSaved(false);
          }
        },
        text.detailsReset
      ),
      saved ? React.createElement("span", { style: { opacity: 0.7 } }, text.detailsSaved) : null
    ) : null
  );
}
function BatchList(props) {
  const { batch, text, isPicked, onToggle, onEdit, onPromote, titleOf } = props;
  if (batch === void 0) {
    return React.createElement("div", { style: { marginTop: "8px", opacity: 0.7 } }, text.batchEmpty);
  }
  return React.createElement(
    "div",
    { style: { marginTop: "8px", display: "grid", gap: "2px" } },
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, justifyContent: "space-between", opacity: 0.8 } },
      React.createElement("strong", null, `${text.batchHeading} \xB7 ${String(batch.entries.length)}`),
      React.createElement("span", null, batch.scope)
    ),
    ...batch.entries.map(
      (entry, index) => React.createElement(
        "details",
        { key: `${String(index)}:${entry.id ?? entry.title}`, style: { padding: "2px 0" } },
        // The panel sits in a 340px dock, so the row must never wrap: the
        // checkbox and the status keep their width and the title takes what is
        // left and ellipsises. The flex row lives inside <summary> instead of
        // replacing its display, otherwise the disclosure marker disappears.
        React.createElement(
          "summary",
          { style: { cursor: "pointer" } },
          React.createElement(
            "div",
            { style: { ...ROW_STYLE, gap: "6px", flexWrap: "nowrap", overflow: "hidden" } },
            entry.id === void 0 ? React.createElement("span", { style: { width: "13px", flexShrink: 0 } }) : React.createElement("input", {
              type: "checkbox",
              checked: isPicked(entry),
              title: text.exportSelection,
              onClick: (event) => event.stopPropagation(),
              onChange: (event) => onToggle(entry.id, event.target.checked),
              style: { flexShrink: 0, margin: 0 }
            }),
            React.createElement(
              "span",
              { style: { color: STATUS_TONE[entry.status], flexShrink: 0, whiteSpace: "nowrap" } },
              statusLabel(entry, text)
            ),
            entry.annotated === true ? React.createElement(
              "span",
              { title: text.annotated, style: { flexShrink: 0, opacity: 0.65 } },
              "\u270E"
            ) : null,
            React.createElement(
              "span",
              {
                style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                title: titleOf(entry)
              },
              titleOf(entry) === "" ? entry.doi ?? entry.arxivId ?? "\u2014" : titleOf(entry)
            )
          )
        ),
        React.createElement(EntryDetails, { entry, text, onSave: onEdit }),
        // Only a quarantined row can move: verified rows are already in the
        // library and skipped rows never became candidates.
        entry.status === "quarantined" && entry.id !== void 0 ? React.createElement(
          "div",
          { style: { display: "flex", gap: "6px", padding: "0 0 8px 19px" } },
          React.createElement(
            "button",
            { type: "button", onClick: () => onPromote(entry, false) },
            text.promoteVerify
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => onPromote(entry, true) },
            text.promoteManual
          )
        ) : null
      )
    )
  );
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
  gap: "4px",
  height: "28px",
  padding: "0 8px",
  borderRadius: "6px",
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: "12px",
  cursor: "pointer"
};
var PANEL_STYLE = {
  // Rendered from the composer dock, but pinned to the right edge so the long
  // annotation form never pushes the composer or covers the transcript.
  position: "fixed",
  right: "24px",
  top: "84px",
  zIndex: 60,
  width: "360px",
  maxWidth: "calc(100vw - 32px)",
  maxHeight: "calc(100vh - 140px)",
  overflowY: "auto",
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
  padding: "4px 6px",
  borderRadius: "6px",
  border: "1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35))",
  background: "var(--dsw-alias-bg-l1, transparent)",
  color: "inherit",
  font: "inherit",
  fontSize: "12px"
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
  const rememberedDir = dir === void 0 || dir.dir === null ? "" : dir.dir;
  const [dirDraft, setDirDraft] = React.useState(rememberedDir);
  const [dirSeed, setDirSeed] = React.useState(rememberedDir);
  if (dirSeed !== rememberedDir) {
    setDirSeed(rememberedDir);
    setDirDraft(rememberedDir);
  }
  const batchKey = batch === void 0 ? "" : `${batch.capturedAt}:${String(batch.entries.length)}`;
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
      onChange: (event) => setState({ [key]: event.target.checked })
    }),
    label
  );
  const canExport = current.bibtex || current.ris;
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
  return React.createElement(
    "section",
    { style: PANEL_STYLE, "aria-label": "dsh-refkeeper panel" },
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, justifyContent: "space-between" } },
      React.createElement("strong", null, `\u275D ${text.heading}`),
      React.createElement(
        "button",
        { type: "button", onClick: () => setState({ open: false }), style: { ...BASE_BUTTON, height: "24px", padding: "0 6px" } },
        text.close
      )
    ),
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, marginTop: "6px" } },
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
    ),
    React.createElement(BatchList, { batch, text, isPicked, onToggle, onEdit, onPromote, titleOf }),
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, marginTop: "4px", justifyContent: "space-between", gap: "8px" } },
      React.createElement(
        "span",
        {
          title: rememberedDir === "" ? text.defaultDirUnset : rememberedDir,
          style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.75 }
        },
        `${text.defaultDirLabel}: ${rememberedDir === "" ? text.defaultDirUnset : rememberedDir}`
      ),
      React.createElement("button", { type: "button", onClick: () => setNonce((value) => value + 1), style: { ...BASE_BUTTON, flexShrink: 0 } }, text.refresh)
    ),
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, marginTop: "4px", gap: "6px", flexWrap: "nowrap" } },
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
      { style: { ...ROW_STYLE, marginTop: "4px" } },
      React.createElement("span", { style: { opacity: 0.75 } }, `${text.formatLabel}:`),
      formatOption("bibtex", text.formatBibtex),
      formatOption("ris", text.formatRis)
    ),
    React.createElement(
      "div",
      { style: { ...ROW_STYLE, marginTop: "8px" } },
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
    notice === "" ? null : React.createElement("div", { style: { marginTop: "6px", color: "var(--dsw-alias-warn, #b26a00)" } }, notice)
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
