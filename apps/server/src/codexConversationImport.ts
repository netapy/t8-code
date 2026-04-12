import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ServerImportCodexConversationsResult,
  type ServerImportCodexConversationsSkippedEntry,
  type ServerImportCodexConversationsSkippedReason,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationCommandInvariantError } from "./orchestration/Errors.ts";

interface ImportCodexConversationsInput {
  readonly cwd: string;
  readonly orchestrationEngine: OrchestrationEngineShape;
}

interface CodexStateRow {
  readonly id: string;
  readonly cwd: string;
  readonly rolloutPath: string;
  readonly createdAtSeconds: number;
  readonly updatedAtSeconds: number;
  readonly title: string;
  readonly firstUserMessage: string;
}

interface CodexImportedMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CodexImportedThread {
  readonly sourceThreadId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<CodexImportedMessage>;
}

const IMPORT_THREAD_PREFIX = "codex-import:thread:";
const IMPORT_MESSAGE_PREFIX = "codex-import:message:";
const IMPORT_COMMAND_PREFIX = "server:codex-import:";
const MAX_IMPORTED_TITLE_CHARS = 120;

function newServerCommandId(): CommandId {
  return CommandId.make(`${IMPORT_COMMAND_PREFIX}${crypto.randomUUID()}`);
}

function importedThreadIdForSource(sourceThreadId: string): ThreadId {
  return ThreadId.make(`${IMPORT_THREAD_PREFIX}${sourceThreadId}`);
}

function importedMessageIdForSource(sourceThreadId: string, index: number): MessageId {
  return MessageId.make(`${IMPORT_MESSAGE_PREFIX}${sourceThreadId}:${index}`);
}

function importedMessagePrefixForSource(sourceThreadId: string): string {
  return `${IMPORT_MESSAGE_PREFIX}${sourceThreadId}:`;
}

function toIsoFromSeconds(input: number): string {
  return new Date(input * 1000).toISOString();
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeImportedTitle(input: { title: string; firstUserMessage: string }): string {
  const candidates = [
    ...input.title
      .split(/\r?\n/)
      .map((line) => collapseWhitespace(line))
      .filter((line) => line.length > 0),
    collapseWhitespace(input.firstUserMessage),
    "Imported from Codex",
  ];
  const selected = candidates.find((candidate) => candidate.length > 0) ?? "Imported from Codex";
  return selected.slice(0, MAX_IMPORTED_TITLE_CHARS);
}

function resolveCodexHome(): string {
  const raw = process.env.CODEX_HOME?.trim();
  if (!raw) {
    return path.join(os.homedir(), ".codex");
  }
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return path.resolve(raw);
}

function makeSkippedEntry(
  sourceThreadId: string,
  title: string,
  reason: ServerImportCodexConversationsSkippedReason,
): ServerImportCodexConversationsSkippedEntry {
  return {
    sourceThreadId,
    title: collapseWhitespace(title) || "Codex import",
    reason,
  };
}

async function readRolloutMessages(
  rolloutPath: string,
): Promise<ReadonlyArray<CodexImportedMessage>> {
  const content = await fs.readFile(rolloutPath, "utf8");
  const messages: CodexImportedMessage[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const parsed = JSON.parse(line) as {
      timestamp?: unknown;
      type?: unknown;
      payload?: Record<string, unknown>;
    };
    if (parsed.type !== "event_msg" || !parsed.payload) {
      continue;
    }

    const timestamp =
      typeof parsed.timestamp === "string" && parsed.timestamp.trim().length > 0
        ? parsed.timestamp
        : new Date().toISOString();
    const payloadType = parsed.payload.type;
    if (payloadType === "user_message") {
      const text = typeof parsed.payload.message === "string" ? parsed.payload.message.trim() : "";
      if (text.length === 0) {
        continue;
      }
      messages.push({
        role: "user",
        text,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      continue;
    }

    if (payloadType === "agent_message" && parsed.payload.phase === "final_answer") {
      const text = typeof parsed.payload.message === "string" ? parsed.payload.message.trim() : "";
      if (text.length === 0) {
        continue;
      }
      messages.push({
        role: "assistant",
        text,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return messages;
}

function readCodexThreadsForCwds(input: {
  readonly codexHome: string;
  readonly cwds: ReadonlyArray<string>;
}): ReadonlyArray<CodexStateRow> {
  if (input.cwds.length === 0) {
    return [];
  }

  const stateDbPath = path.join(input.codexHome, "state_5.sqlite");
  const db = new DatabaseSync(stateDbPath, { readOnly: true });
  try {
    const placeholders = input.cwds.map(() => "?").join(", ");
    const statement = db.prepare(`
      SELECT
        id,
        cwd,
        rollout_path AS rolloutPath,
        created_at AS createdAtSeconds,
        updated_at AS updatedAtSeconds,
        title,
        first_user_message AS firstUserMessage
      FROM threads
      WHERE cwd IN (${placeholders}) AND archived = 0
      ORDER BY updated_at DESC, id DESC
    `);
    const rows = statement.all(...input.cwds) as ReadonlyArray<Record<string, unknown>>;
    return rows.flatMap((row) => {
      if (
        typeof row.id !== "string" ||
        typeof row.cwd !== "string" ||
        typeof row.rolloutPath !== "string" ||
        typeof row.createdAtSeconds !== "number" ||
        typeof row.updatedAtSeconds !== "number" ||
        typeof row.title !== "string" ||
        typeof row.firstUserMessage !== "string"
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          cwd: row.cwd,
          rolloutPath: row.rolloutPath,
          createdAtSeconds: row.createdAtSeconds,
          updatedAtSeconds: row.updatedAtSeconds,
          title: row.title,
          firstUserMessage: row.firstUserMessage,
        },
      ];
    });
  } finally {
    db.close();
  }
}

function findProjectForCwd(
  readModel: OrchestrationReadModel,
  cwd: string,
): OrchestrationProject | null {
  return (
    readModel.projects.find(
      (project) => project.workspaceRoot === cwd && project.deletedAt === null,
    ) ?? null
  );
}

function findAnyThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | null {
  return readModel.threads.find((thread) => thread.id === threadId) ?? null;
}

function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | null {
  const thread = findAnyThreadById(readModel, threadId);
  return thread?.deletedAt === null ? thread : null;
}

async function loadCodexImportedThread(
  row: CodexStateRow,
  codexHome: string,
): Promise<CodexImportedThread> {
  const rolloutPath = path.isAbsolute(row.rolloutPath)
    ? row.rolloutPath
    : path.resolve(codexHome, row.rolloutPath);
  const messages = await readRolloutMessages(rolloutPath);
  return {
    sourceThreadId: row.id,
    title: normalizeImportedTitle({
      title: row.title,
      firstUserMessage: row.firstUserMessage,
    }),
    createdAt: toIsoFromSeconds(row.createdAtSeconds),
    updatedAt: toIsoFromSeconds(row.updatedAtSeconds),
    messages,
  };
}

async function ensureProject(input: {
  readonly cwd: string;
  readonly orchestrationEngine: OrchestrationEngineShape;
}): Promise<OrchestrationProject> {
  let readModel = await Effect.runPromise(input.orchestrationEngine.getReadModel());
  let project = findProjectForCwd(readModel, input.cwd);
  if (project) {
    return project;
  }

  const title = path.basename(input.cwd) || "project";
  const createdAt = new Date().toISOString();
  const projectId = ProjectId.make(crypto.randomUUID());
  await Effect.runPromise(
    input.orchestrationEngine.dispatch({
      type: "project.create",
      commandId: newServerCommandId(),
      projectId,
      title,
      workspaceRoot: input.cwd,
      defaultModelSelection: { provider: "codex", model: DEFAULT_MODEL_BY_PROVIDER.codex },
      createdAt,
    }),
  );

  readModel = await Effect.runPromise(input.orchestrationEngine.getReadModel());
  project = findProjectForCwd(readModel, input.cwd);
  if (!project) {
    throw new Error(`Failed to create project for '${input.cwd}'.`);
  }
  return project;
}

function isThreadAlreadyExistsError(error: unknown, threadId: ThreadId): boolean {
  return (
    Schema.is(OrchestrationCommandInvariantError)(error) &&
    error.commandType === "thread.create" &&
    error.detail.includes(`Thread '${threadId}' already exists`)
  );
}

export async function importCodexConversations(
  input: ImportCodexConversationsInput,
): Promise<ServerImportCodexConversationsResult> {
  const bootstrapProject = await ensureProject({
    cwd: input.cwd,
    orchestrationEngine: input.orchestrationEngine,
  });
  const codexHome = resolveCodexHome();
  const skipped: ServerImportCodexConversationsSkippedEntry[] = [];
  let createdThreadCount = 0;
  let refreshedThreadCount = 0;
  let latestImportedThreadId: ThreadId | undefined;

  if (!existsSync(codexHome)) {
    return {
      projectId: bootstrapProject.id,
      createdThreadCount,
      refreshedThreadCount,
      skippedThreadCount: 1,
      skipped: [makeSkippedEntry("codex-home", codexHome, "missing-codex-home")],
    };
  }

  const stateDbPath = path.join(codexHome, "state_5.sqlite");
  if (!existsSync(stateDbPath)) {
    return {
      projectId: bootstrapProject.id,
      createdThreadCount,
      refreshedThreadCount,
      skippedThreadCount: 1,
      skipped: [makeSkippedEntry("codex-state-db", stateDbPath, "missing-state-db")],
    };
  }

  let readModel = await Effect.runPromise(input.orchestrationEngine.getReadModel());
  const targetProjects = readModel.projects.filter((project) => project.deletedAt === null);
  const targetCwds = Array.from(
    new Set(targetProjects.map((project) => project.workspaceRoot).filter((cwd) => cwd.length > 0)),
  );
  const sourceRows = readCodexThreadsForCwds({ codexHome, cwds: targetCwds });

  for (const row of sourceRows) {
    const project = findProjectForCwd(readModel, row.cwd);
    if (!project) {
      skipped.push(makeSkippedEntry(row.id, row.title, "diverged"));
      continue;
    }

    let sourceThread: CodexImportedThread;
    const normalizedTitle = normalizeImportedTitle({
      title: row.title,
      firstUserMessage: row.firstUserMessage,
    });
    const rolloutPath = path.isAbsolute(row.rolloutPath)
      ? row.rolloutPath
      : path.resolve(codexHome, row.rolloutPath);

    if (!existsSync(rolloutPath)) {
      skipped.push(makeSkippedEntry(row.id, normalizedTitle, "missing-rollout"));
      continue;
    }

    try {
      sourceThread = await loadCodexImportedThread(row, codexHome);
    } catch {
      skipped.push(makeSkippedEntry(row.id, normalizedTitle, "parse-error"));
      continue;
    }

    if (sourceThread.messages.length === 0) {
      skipped.push(makeSkippedEntry(row.id, sourceThread.title, "parse-error"));
      continue;
    }

    const threadId = importedThreadIdForSource(sourceThread.sourceThreadId);
    const messagePrefix = importedMessagePrefixForSource(sourceThread.sourceThreadId);
    const existingThreadRecord = findAnyThreadById(readModel, threadId);
    const existingThread = findThreadById(readModel, threadId);

    if (existingThreadRecord && existingThreadRecord.deletedAt !== null) {
      skipped.push(makeSkippedEntry(sourceThread.sourceThreadId, sourceThread.title, "diverged"));
      continue;
    }

    if (
      existingThread &&
      existingThread.messages.some((message) => !message.id.startsWith(messagePrefix))
    ) {
      skipped.push(makeSkippedEntry(sourceThread.sourceThreadId, sourceThread.title, "diverged"));
      continue;
    }

    if (existingThread && existingThread.messages.length > sourceThread.messages.length) {
      skipped.push(
        makeSkippedEntry(sourceThread.sourceThreadId, sourceThread.title, "source-rewritten"),
      );
      continue;
    }

    let thread = existingThread;

    if (!thread) {
      let createdThread = false;
      try {
        await Effect.runPromise(
          input.orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: newServerCommandId(),
            threadId,
            projectId: project.id,
            title: sourceThread.title,
            modelSelection: project.defaultModelSelection ?? {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt: sourceThread.createdAt,
          }),
        );
        createdThread = true;
      } catch (error) {
        if (!isThreadAlreadyExistsError(error, threadId)) {
          throw error;
        }
      }

      readModel = await Effect.runPromise(input.orchestrationEngine.getReadModel());
      thread = findThreadById(readModel, threadId);
      const threadRecord = findAnyThreadById(readModel, threadId);
      if (threadRecord?.deletedAt !== null) {
        skipped.push(makeSkippedEntry(sourceThread.sourceThreadId, sourceThread.title, "diverged"));
        continue;
      }
      if (!thread) {
        throw new Error(`Imported thread '${threadId}' exists but could not be loaded.`);
      }
      if (createdThread) {
        createdThreadCount += 1;
      } else {
        refreshedThreadCount += 1;
      }
    } else {
      if (thread.title !== sourceThread.title) {
        await Effect.runPromise(
          input.orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: newServerCommandId(),
            threadId,
            title: sourceThread.title,
          }),
        );
      }
      refreshedThreadCount += 1;
    }

    for (const [index, message] of sourceThread.messages.entries()) {
      await Effect.runPromise(
        input.orchestrationEngine.dispatch({
          type: "thread.message.import",
          commandId: newServerCommandId(),
          threadId,
          message: {
            messageId: importedMessageIdForSource(sourceThread.sourceThreadId, index + 1),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          },
        }),
      );
    }

    if (latestImportedThreadId === undefined) {
      latestImportedThreadId = threadId;
    }
    readModel = await Effect.runPromise(input.orchestrationEngine.getReadModel());
  }

  return {
    projectId: bootstrapProject.id,
    createdThreadCount,
    refreshedThreadCount,
    skippedThreadCount: skipped.length,
    skipped,
    ...(latestImportedThreadId ? { latestImportedThreadId } : {}),
  };
}
