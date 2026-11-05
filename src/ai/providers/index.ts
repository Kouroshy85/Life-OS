import { isTauri } from "../../persistence/driver";
import { tauriLlamaProvider } from "./tauriLlama";
import type { LocalModelProvider } from "./types";
import { unavailableProvider } from "./unavailable";

let override: LocalModelProvider | null = null;

/** The model provider for this build. Desktop builds that lack the engine report themselves unavailable through status(). */
export function getProvider(): LocalModelProvider {
  if (override) return override;
  return isTauri() ? tauriLlamaProvider : unavailableProvider;
}

/** For tests. */
export function setProvider(provider: LocalModelProvider | null) {
  override = provider;
}
