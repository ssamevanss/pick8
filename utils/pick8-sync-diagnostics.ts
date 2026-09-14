import { AsyncLocalStorage } from "node:async_hooks";

export type SyncStage = "discovery" | "who_you_got" | "fixture_application" | "scoring" | "competition_refresh" | "total";

const diagnosticContext = new AsyncLocalStorage<Record<string, unknown>>();

export function createSyncDiagnostics(context: Record<string, unknown>) {
  const parent = diagnosticContext.getStore();
  const fields = { ...parent, runId: parent?.runId ?? globalThis.crypto.randomUUID(), ...context };
  return {
    event(event: Record<string, unknown>) {
      console.info(JSON.stringify({ ...fields, correlationId: fields.runId, ...event }));
    },
    async stage<T>(stage: SyncStage, operation: () => Promise<T>): Promise<T> {
      const started = performance.now();
      try {
        const result = await diagnosticContext.run(fields, operation);
        console.info(JSON.stringify({ service: "pick8-sync-stage", ...fields, stage, success: true, durationMs: Math.round(performance.now() - started) }));
        return result;
      } catch (error) {
        console.error(JSON.stringify({ service: "pick8-sync-stage", ...fields, stage, success: false, durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : "Unexpected failure" }));
        throw error;
      }
    },
    skipped(stage: SyncStage, reason: string) {
      console.info(JSON.stringify({ service: "pick8-sync-stage", ...fields, stage, success: true, skipped: true, reason, durationMs: 0 }));
    },
  };
}
