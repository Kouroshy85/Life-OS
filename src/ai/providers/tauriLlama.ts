/**
 * Desktop provider: llama.cpp running inside the Rust backend, reached only through
 * Tauri commands. No server or network port is involved.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { newId } from "../../persistence/repository";
import {
  ProviderError,
  type GenerateRequest,
  type GenerateResult,
  type LoadedModel,
  type LocalModelProvider,
  type ModelInfo,
  type ProviderErrorCode,
  type ProviderStatus,
} from "./types";

const CODES: ProviderErrorCode[] = ["unavailable", "model_missing", "insufficient_memory", "load_failed", "generation_failed", "cancelled", "invalid_model", "download_failed"];

/** Turns a command error ({ code, message } or a plain string) into a ProviderError. */
export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e && typeof e === "object" && "code" in e) {
    const code = String((e as { code: unknown }).code);
    const message = String((e as { message?: unknown }).message ?? code);
    return new ProviderError(CODES.includes(code as ProviderErrorCode) ? (code as ProviderErrorCode) : "generation_failed", message);
  }
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  // A build without the engine doesn't register the commands at all.
  if (/not found|unknown command|not allowed/i.test(text)) return new ProviderError("unavailable", text);
  return new ProviderError("generation_failed", text);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toProviderError(e);
  }
}

type GenEvent = { kind: "token"; text: string } | { kind: "done" };

export const tauriLlamaProvider: LocalModelProvider = {
  kind: "desktop",
  status: () => call<ProviderStatus>("ai_status"),
  listModels: () => call<ModelInfo[]>("ai_models"),
  load: (modelId) => call<LoadedModel>("ai_load", { modelId }),
  unload: () => call<void>("ai_unload"),
  setIdleUnload: (minutes) => call<void>("ai_set_idle_unload", { minutes }),

  async generate(request: GenerateRequest, onToken, signal): Promise<GenerateResult> {
    const requestId = newId();
    const onEvent = new Channel<GenEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === "token") onToken(event.text);
    };
    const abort = () => void invoke("ai_cancel", { requestId }).catch(() => undefined);
    if (signal?.aborted) throw new ProviderError("cancelled", "Stopped.");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await call<GenerateResult>("ai_generate", { request: { requestId, ...request }, onEvent });
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  },

  async importModel() {
    const path = await call<string | null>("plugin:dialog|open", {
      options: { multiple: false, directory: false, filters: [{ name: "GGUF model", extensions: ["gguf"] }] },
    });
    if (!path) return null;
    return call<ModelInfo>("ai_import_model", { path });
  },

  async downloadModel(modelId, onProgress) {
    const channel = new Channel<{ received: number; total: number }>();
    channel.onmessage = (p) => onProgress(p.received, p.total);
    return call<ModelInfo>("ai_download_model", { modelId, onProgress: channel });
  },

  deleteModel: (modelId) => call<void>("ai_delete_model", { modelId }),
};
