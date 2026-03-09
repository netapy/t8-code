import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { KeybindingRule, ResolvedKeybindingsConfig } from "./keybindings";
import { EditorId } from "./editor";
import { ProviderKind } from "./orchestration";

const KeybindingsMalformedConfigIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.malformed-config"),
  message: TrimmedNonEmptyString,
});

const KeybindingsInvalidEntryIssue = Schema.Struct({
  kind: Schema.Literal("keybindings.invalid-entry"),
  message: TrimmedNonEmptyString,
  index: Schema.Number,
});

export const ServerConfigIssue = Schema.Union([
  KeybindingsMalformedConfigIssue,
  KeybindingsInvalidEntryIssue,
]);
export type ServerConfigIssue = typeof ServerConfigIssue.Type;

const ServerConfigIssues = Schema.Array(ServerConfigIssue);

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

const ServerProviderStatuses = Schema.Array(ServerProviderStatus);

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  keybindingsConfigPath: TrimmedNonEmptyString,
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
  availableEditors: Schema.Array(EditorId),
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerUpsertKeybindingInput = KeybindingRule;
export type ServerUpsertKeybindingInput = typeof ServerUpsertKeybindingInput.Type;

export const ServerUpsertKeybindingResult = Schema.Struct({
  keybindings: ResolvedKeybindingsConfig,
  issues: ServerConfigIssues,
});
export type ServerUpsertKeybindingResult = typeof ServerUpsertKeybindingResult.Type;

export const ServerImportCodexConversationsInput = Schema.Struct({});
export type ServerImportCodexConversationsInput = typeof ServerImportCodexConversationsInput.Type;

export const ServerImportCodexConversationsSkippedReason = Schema.Literals([
  "missing-codex-home",
  "missing-state-db",
  "missing-rollout",
  "parse-error",
  "diverged",
  "source-rewritten",
]);
export type ServerImportCodexConversationsSkippedReason =
  typeof ServerImportCodexConversationsSkippedReason.Type;

export const ServerImportCodexConversationsSkippedEntry = Schema.Struct({
  sourceThreadId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  reason: ServerImportCodexConversationsSkippedReason,
});
export type ServerImportCodexConversationsSkippedEntry =
  typeof ServerImportCodexConversationsSkippedEntry.Type;

export const ServerImportCodexConversationsResult = Schema.Struct({
  projectId: ProjectId,
  createdThreadCount: Schema.Number,
  refreshedThreadCount: Schema.Number,
  skippedThreadCount: Schema.Number,
  skipped: Schema.Array(ServerImportCodexConversationsSkippedEntry),
  latestImportedThreadId: Schema.optional(ThreadId),
});
export type ServerImportCodexConversationsResult =
  typeof ServerImportCodexConversationsResult.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  issues: ServerConfigIssues,
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
