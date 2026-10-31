import { isTauri } from "./driver";

/**
 * Where song files live: on disk in the desktop app, in IndexedDB in the browser
 * preview. Uploads go chunk by chunk, so progress reports bytes actually written.
 */
export interface AudioStore {
  save(id: string, ext: string, file: Blob, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<void>;
  url(id: string, ext: string): Promise<string>;
  remove(id: string, ext: string): Promise<void>;
  clear(): Promise<void>;
}

const CHUNK = 512 * 1024;

export class UploadCancelled extends Error {}

async function forEachChunk(file: Blob, onProgress: (fraction: number) => void, signal: AbortSignal, write: (bytes: Uint8Array) => Promise<void>) {
  const total = file.size || 1;
  for (let at = 0; at < file.size; at += CHUNK) {
    if (signal.aborted) throw new UploadCancelled();
    const bytes = new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
    await write(bytes);
    onProgress(Math.min(1, (at + bytes.length) / total));
  }
}

function tauriStore(): AudioStore {
  const core = () => import("@tauri-apps/api/core");
  return {
    async save(id, ext, file, onProgress, signal) {
      const { invoke } = await core();
      await invoke("audio_begin", { id, ext });
      try {
        await forEachChunk(file, onProgress, signal, (bytes) => invoke("audio_chunk", bytes, { headers: { "x-audio-id": id, "x-audio-ext": ext } }));
        await invoke("audio_finish", { id, ext });
      } catch (e) {
        await invoke("audio_abort", { id, ext }).catch(() => undefined);
        throw e;
      }
    },
    async url(id, ext) {
      const { invoke, convertFileSrc } = await core();
      return convertFileSrc(await invoke<string>("audio_path", { id, ext }));
    },
    async remove(id, ext) {
      const { invoke } = await core();
      await invoke("audio_delete", { id, ext });
    },
    async clear() {
      const { invoke } = await core();
      await invoke("audio_clear").catch(() => undefined);
    },
  };
}

const DB = "life-os-audio";
const STORE = "songs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = act(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function browserStore(): AudioStore {
  const urls = new Map<string, string>();
  return {
    async save(id, _ext, file, onProgress, signal) {
      const parts: Uint8Array<ArrayBuffer>[] = [];
      await forEachChunk(file, onProgress, signal, async (bytes) => {
        parts.push(bytes as Uint8Array<ArrayBuffer>);
      });
      await run("readwrite", (s) => s.put(new Blob(parts, { type: file.type }), id));
    },
    async url(id) {
      const known = urls.get(id);
      if (known) return known;
      const blob = await run<Blob>("readonly", (s) => s.get(id));
      const url = URL.createObjectURL(blob);
      urls.set(id, url);
      return url;
    },
    async remove(id) {
      await run("readwrite", (s) => s.delete(id));
    },
    async clear() {
      await run("readwrite", (s) => s.clear());
    },
  };
}

let store: AudioStore | null = null;
export const audioStore = (): AudioStore => (store ??= isTauri() ? tauriStore() : browserStore());
