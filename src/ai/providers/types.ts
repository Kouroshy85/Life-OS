/**
 * The boundary between Life OS and a local language model.
 *
 * The chat, prompt, validation and planning code only talk to this interface. The
 * desktop app implements it with llama.cpp in the Rust backend; a phone build can
 * add its own native implementation behind the same commands later.
 */

export type ProviderErrorCode =
  | "unavailable"
  | "model_missing"
  | "insufficient_memory"
  | "load_failed"
  | "generation_failed"
  | "cancelled"
  | "invalid_model"
  | "download_failed";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type EngineState = "idle" | "loading" | "ready" | "generating";

export interface LoadedModel {
  id: string;
  name: string;
  quant: string;
  fileSize: number;
  nCtx: number;
}

export interface ProviderStatus {
  /** False when this build or device can't run a local model at all. */
  available: boolean;
  state: EngineState;
  runtime: { llamaCpp: string } | null;
  loaded: LoadedModel | null;
  ramTotalMb: number;
  ramAvailableMb: number;
  idleUnloadMin: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  installed: boolean;
  minRamMb: number;
  licence: string;
  /** True for models Life OS knows how to download. */
  catalog: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  system: string;
  messages: ChatTurn[];
  /** JSON schema the output must follow, enforced by a grammar while generating. */
  jsonSchema: string | null;
  maxTokens: number;
  temperature: number;
}

export interface GenerateResult {
  text: string;
  stopReason: "stop" | "length" | "cancelled" | "timeout";
  tokens: number;
  ms: number;
}

export interface LocalModelProvider {
  readonly kind: "desktop" | "unavailable" | "mock";
  status(): Promise<ProviderStatus>;
  listModels(): Promise<ModelInfo[]>;
  load(modelId: string): Promise<LoadedModel>;
  unload(): Promise<void>;
  setIdleUnload(minutes: number): Promise<void>;
  /** Streams tokens through `onToken`. Aborting `signal` stops generation and resolves with stopReason "cancelled". */
  generate(request: GenerateRequest, onToken: (text: string) => void, signal?: AbortSignal): Promise<GenerateResult>;
  /** Asks the user for a GGUF file and copies it into the models folder. Null if they cancel. */
  importModel(): Promise<ModelInfo | null>;
  downloadModel(modelId: string, onProgress: (received: number, total: number) => void): Promise<ModelInfo>;
  deleteModel(modelId: string): Promise<void>;
}

export const UNAVAILABLE_STATUS: ProviderStatus = {
  available: false,
  state: "idle",
  runtime: null,
  loaded: null,
  ramTotalMb: 0,
  ramAvailableMb: 0,
  idleUnloadMin: 10,
};
