import { syncGeneration } from "./orchestrator";
import type { GenerationStatus } from "./types";

type PollerState = {
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
};

const terminalStatuses = new Set<GenerationStatus>(["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]);
const pollers = globalThis as typeof globalThis & {
  __superReferralsGenerationPollers?: Map<string, PollerState>;
};

function getPollers() {
  pollers.__superReferralsGenerationPollers ||= new Map<string, PollerState>();
  return pollers.__superReferralsGenerationPollers;
}

export function startGenerationPolling(
  generationId: string,
  options: { intervalMs?: number; maxAttempts?: number } = {}
) {
  const activePollers = getPollers();
  if (activePollers.has(generationId)) {
    return { generationId, started: false };
  }

  const intervalMs = options.intervalMs || 8000;
  const maxAttempts = options.maxAttempts || 120;
  const state: PollerState = { attempts: 0 };
  activePollers.set(generationId, state);

  const stop = () => {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    activePollers.delete(generationId);
  };

  const schedule = () => {
    state.timer = setTimeout(tick, intervalMs);
    state.timer.unref?.();
  };

  const tick = async () => {
    state.attempts += 1;
    try {
      const generation = await syncGeneration(generationId);
      if (!generation || terminalStatuses.has(generation.status)) {
        stop();
        return;
      }
      if (state.attempts >= maxAttempts) {
        stop();
        return;
      }
      schedule();
    } catch {
      if (state.attempts >= maxAttempts) {
        stop();
        return;
      }
      schedule();
    }
  };

  state.timer = setTimeout(tick, 0);
  state.timer.unref?.();
  return { generationId, started: true };
}
