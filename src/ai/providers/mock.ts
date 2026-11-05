/**
 * A scripted model for tests. Each call to `generate` takes the next scripted reply
 * and streams it in small pieces, so streaming, cancelling and bad output can all be
 * tested without a real model.
 */

import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LoadedModel,
  type LocalModelProvider,
  type ModelInfo,
  type ProviderStatus,
} from "./types";

export interface MockProvider extends LocalModelProvider {
  /** Every request the mock received, newest last. */
  requests: GenerateRequest[];
  /** Replies still to be given, in order. A function can throw to simulate a failure. */
  script: (string | ((request: GenerateRequest) => string))[];
  /** Pause between streamed pieces, in ms. Lets tests abort mid-stream. */
  delayMs: number;
  loaded: LoadedModel | null;
}

const MODEL: ModelInfo = {
  id: "mock-2b",
  name: "Mock model",
  fileName: "mock.gguf",
  sizeBytes: 1,
  installed: true,
  minRamMb: 1,
  licence: "test",
  catalog: false,
};

export function createMockProvider(script: MockProvider["script"] = []): MockProvider {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const mock: MockProvider = {
    kind: "mock",
    requests: [],
    script,
    delayMs: 0,
    loaded: null,
    async status(): Promise<ProviderStatus> {
      return {
        available: true,
        state: mock.loaded ? "ready" : "idle",
        runtime: { llamaCpp: "mock" },
        loaded: mock.loaded,
        ramTotalMb: 16000,
        ramAvailableMb: 8000,
        idleUnloadMin: 10,
      };
    },
    listModels: async () => [MODEL],
    async load(modelId) {
      if (modelId !== MODEL.id) throw new ProviderError("model_missing", "No such model.");
      mock.loaded = { id: MODEL.id, name: MODEL.name, quant: "Q4_K_M", fileSize: 1, nCtx: 8192 };
      return mock.loaded;
    },
    async unload() {
      mock.loaded = null;
    },
    setIdleUnload: async () => undefined,
    async generate(request, onToken, signal): Promise<GenerateResult> {
      mock.requests.push(request);
      if (!mock.loaded) await mock.load(MODEL.id);
      const next = mock.script.shift();
      if (next === undefined) throw new ProviderError("generation_failed", "The mock has no reply left.");
      const text = typeof next === "function" ? next(request) : next;
      let out = "";
      for (let i = 0; i < text.length; i += 12) {
        if (signal?.aborted) return { text: out, stopReason: "cancelled", tokens: out.length, ms: 1 };
        const piece = text.slice(i, i + 12);
        out += piece;
        onToken(piece);
        if (mock.delayMs) await sleep(mock.delayMs);
      }
      return { text: out, stopReason: "stop", tokens: out.length, ms: 1 };
    },
    importModel: async () => MODEL,
    downloadModel: async () => MODEL,
    deleteModel: async () => undefined,
  };
  return mock;
}
