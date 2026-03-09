import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { Effect, Stream, type Effect as EffectType } from "effect";
import type { OrchestrationCommand, OrchestrationReadModel } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { importCodexConversations } from "./codexConversationImport";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";

const FIXED_NOW = "2026-03-09T00:00:00.000Z";

class FakeOrchestrationEngine implements OrchestrationEngineShape {
  private sequence = 0;
  private readModel: OrchestrationReadModel = {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: FIXED_NOW,
  };

  readonly getReadModel = (): EffectType.Effect<OrchestrationReadModel, never, never> =>
    Effect.succeed(this.readModel);

  readonly readEvents = () => Stream.empty;

  readonly streamDomainEvents = Stream.empty;

  readonly dispatch = (
    command: OrchestrationCommand,
  ): EffectType.Effect<{ sequence: number }, never, never> =>
    Effect.sync(() => {
      switch (command.type) {
        case "project.create": {
          this.readModel = {
            ...this.readModel,
            snapshotSequence: this.readModel.snapshotSequence + 1,
            updatedAt: command.createdAt,
            projects: [
              ...this.readModel.projects,
              {
                id: command.projectId,
                title: command.title,
                workspaceRoot: command.workspaceRoot,
                defaultModel: command.defaultModel ?? null,
                scripts: [],
                createdAt: command.createdAt,
                updatedAt: command.createdAt,
                deletedAt: null,
              },
            ],
          };
          break;
        }

        case "thread.create": {
          this.readModel = {
            ...this.readModel,
            snapshotSequence: this.readModel.snapshotSequence + 1,
            updatedAt: command.createdAt,
            threads: [
              ...this.readModel.threads,
              {
                id: command.threadId,
                projectId: command.projectId,
                title: command.title,
                model: command.model,
                runtimeMode: command.runtimeMode,
                interactionMode: command.interactionMode,
                branch: command.branch,
                worktreePath: command.worktreePath,
                latestTurn: null,
                createdAt: command.createdAt,
                updatedAt: command.createdAt,
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
          };
          break;
        }

        case "thread.meta.update": {
          this.readModel = {
            ...this.readModel,
            snapshotSequence: this.readModel.snapshotSequence + 1,
            threads: this.readModel.threads.map((thread) =>
              thread.id === command.threadId
                ? {
                    ...thread,
                    title: command.title ?? thread.title,
                  }
                : thread,
            ),
          };
          break;
        }

        case "thread.message.import": {
          this.readModel = {
            ...this.readModel,
            snapshotSequence: this.readModel.snapshotSequence + 1,
            updatedAt: command.message.updatedAt,
            threads: this.readModel.threads.map((thread) => {
              if (thread.id !== command.threadId) {
                return thread;
              }
              const existingIndex = thread.messages.findIndex(
                (message) => message.id === command.message.messageId,
              );
              const importedMessage = {
                id: command.message.messageId,
                role: command.message.role,
                text: command.message.text,
                turnId: null,
                streaming: false,
                createdAt: command.message.createdAt,
                updatedAt: command.message.updatedAt,
              };
              if (existingIndex === -1) {
                return {
                  ...thread,
                  updatedAt: command.message.updatedAt,
                  messages: [...thread.messages, importedMessage],
                };
              }
              return {
                ...thread,
                updatedAt: command.message.updatedAt,
                messages: thread.messages.map((message, index) =>
                  index === existingIndex ? importedMessage : message,
                ),
              };
            }),
          };
          break;
        }
      }

      this.sequence += 1;
      return { sequence: this.sequence };
    });
}

async function createCodexHomeFixture(): Promise<{
  codexHome: string;
  cleanup: () => Promise<void>;
}> {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "t8-codex-import-"));
  const db = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT NOT NULL,
      first_user_message TEXT NOT NULL,
      cwd TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
  `);

  await fs.mkdir(path.join(codexHome, "sessions"), { recursive: true });
  const matchingRolloutPath = path.join("sessions", "matching.jsonl");
  const ignoredRolloutPath = path.join("sessions", "ignored.jsonl");

  await fs.writeFile(
    path.join(codexHome, matchingRolloutPath),
    [
      JSON.stringify({
        timestamp: "2026-03-08T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Import this conversation" },
      }),
      JSON.stringify({
        timestamp: "2026-03-08T09:01:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", phase: "analysis", message: "Hidden commentary" },
      }),
      JSON.stringify({
        timestamp: "2026-03-08T09:02:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", phase: "final_answer", message: "Imported answer" },
      }),
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(codexHome, ignoredRolloutPath),
    JSON.stringify({
      timestamp: "2026-03-08T10:00:00.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Wrong cwd" },
    }),
    "utf8",
  );

  const insertThread = db.prepare(`
    INSERT INTO threads (
      id,
      rollout_path,
      created_at,
      updated_at,
      title,
      first_user_message,
      cwd,
      archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertThread.run(
    "codex-thread-match",
    matchingRolloutPath,
    1_741_423_600,
    1_741_423_720,
    "Imported thread",
    "Import this conversation",
    "/workspace/repo",
    0,
  );
  insertThread.run(
    "codex-thread-other",
    ignoredRolloutPath,
    1_741_423_800,
    1_741_423_860,
    "Ignored thread",
    "Wrong cwd",
    "/workspace/other",
    0,
  );
  db.close();

  return {
    codexHome,
    cleanup: () => fs.rm(codexHome, { recursive: true, force: true }),
  };
}

afterEach(() => {
  delete process.env.CODEX_HOME;
});

describe("importCodexConversations", () => {
  it("imports matching Codex conversations and ignores non-final events", async () => {
    const fixture = await createCodexHomeFixture();
    process.env.CODEX_HOME = fixture.codexHome;
    const orchestrationEngine = new FakeOrchestrationEngine();

    try {
      const result = await importCodexConversations({
        cwd: "/workspace/repo",
        orchestrationEngine,
      });
      const readModel = await Effect.runPromise(orchestrationEngine.getReadModel());

      expect(result.createdThreadCount).toBe(1);
      expect(result.refreshedThreadCount).toBe(0);
      expect(result.skippedThreadCount).toBe(0);
      expect(result.latestImportedThreadId).toBe("codex-import:thread:codex-thread-match");
      expect(readModel.projects).toHaveLength(1);
      expect(readModel.projects[0]?.workspaceRoot).toBe("/workspace/repo");
      expect(readModel.threads).toHaveLength(1);
      expect(readModel.threads[0]?.title).toBe("Imported thread");
      expect(readModel.threads[0]?.messages.map((message) => message.text)).toEqual([
        "Import this conversation",
        "Imported answer",
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});
