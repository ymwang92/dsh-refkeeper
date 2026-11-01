import { Context } from "@deepseek-ai/cordis";
/** Tiny TTL cache keyed by URL; only successful responses are stored. */
declare class LookupCache {
  private readonly entries;
  private readonly ttlMs;
  constructor(ttlMs?: number);
  get(url: string, now: number): string | undefined;
  set(url: string, body: string, now: number): void;
  get size(): number;
}
/** Package identity used by diagnostics and the client registrant label. */
export declare const verifyCache: LookupCache;
/** Cordis service key this plugin provides. */
export declare const SERVICE_KEY = "refkeeper";
/**
 * Reports which SDK build the plugin is actually running against.
 *
 * The host version is deliberately not read from `package.json` top-level
 * `version` (that is the plugin's own), and not assumed from an env var (the
 * desktop app does not export one). Resolving the peer package that carries
 * the tool/session contracts answers the question that matters: which API
 * surface is live in this process.
 */
export declare function probeSdkVersion(): string | undefined;
/**
 * Result of `ref_ping`: the M0 contract probe.
 *
 * Every field answers one question the M1/M4 implementation depends on:
 * whether the executing tool can reach the live session, whether the surface
 * enumerates the model-visible order, whether turn boundaries are readable,
 * and whether the host may write inside the session workspace.
 */
export interface ProbeReport {
  readonly plugin: string;
  /** Resolved SDK build, or "unknown" when the peer package cannot be resolved. */
  readonly dshVersion: string;
  readonly agent: boolean;
  /** Empty string when no live session is reachable from the tool. */
  readonly sessionId: string;
  readonly cwd: string;
  readonly surfaceNodes: number;
  /** -1 when the surface is empty. */
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly turnStarts: number;
  /** -1 when no turn boundary is visible. */
  readonly currentTurnStartSeq: number;
  readonly currentTurnEvents: number;
  /** `seq:type` for every surface node, joined by spaces (contract evidence). */
  readonly nodeTypes: string;
  /** Turn count from the `turnOutline` projection; -1 when that unit is not registered. */
  readonly outlineTurns: number;
  /** `turn@seq` per outline entry, joined by spaces. */
  readonly turnOutline: string;
  readonly writeOk: boolean;
  /** Empty string when nothing was attempted or nothing failed. */
  readonly writePath: string;
  readonly writeError: string;
}
/** Diagnostic tool: reports the live-session contract this plugin builds on. */
export declare const refPingTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Verification as a model-facing tool.
 *
 * Same three conditions as `/refs verify`: a title alone that "looks right" is
 * not enough, and a candidate never becomes `verified` without a registry that
 * actually returns the work. The ⚠ statuses are deliberately distinct so the
 * model can say "the network failed, retry" instead of "this citation is fake".
 */
export declare const refVerifyTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
export interface RefSaveToolResult {
  readonly accepted: boolean;
  readonly status: string;
  readonly id: string;
  readonly quarantined: boolean;
  readonly message: string;
}
/** Persist one reference: verify first, then main table or ⚠ quarantine. */
export declare const refSaveTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
export interface RefExportToolResult {
  readonly ok: boolean;
  readonly message: string;
}
/** Export the library as BibTeX and/or RIS inside the workspace. */
export declare const refExportTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare const refCaptureTool: import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Host plugin. Registers the diagnostic tool, the capture tool, and the `/refs`
 * command over one shared read/extract path.
 */
declare const _default: {
  name: string;
  apply(ctx: Context): void;
};
export { _default as default };