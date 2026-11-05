import { ProviderError, UNAVAILABLE_STATUS, type LocalModelProvider } from "./types";

/** Used in the web app and on phones, where no local model runtime exists yet. */
export const unavailableProvider: LocalModelProvider = {
  kind: "unavailable",
  status: async () => UNAVAILABLE_STATUS,
  listModels: async () => [],
  load: async () => {
    throw new ProviderError("unavailable", "Local AI isn't available on this device.");
  },
  unload: async () => undefined,
  setIdleUnload: async () => undefined,
  generate: async () => {
    throw new ProviderError("unavailable", "Local AI isn't available on this device.");
  },
  importModel: async () => null,
  downloadModel: async () => {
    throw new ProviderError("unavailable", "Local AI isn't available on this device.");
  },
  deleteModel: async () => undefined,
};
