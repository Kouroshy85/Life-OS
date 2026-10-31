/**
 * Decides whether a file is really audio by reading its bytes, not trusting its
 * name, and pulls the title and artist out of MP3 tags.
 */

export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export const AUDIO_ACCEPT = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",");
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** Enough of the start of a file to recognise it and read MP3 tags. */
export const SNIFF_BYTES = 256 * 1024;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export const isAudioExtension = (ext: string): ext is AudioExtension => (AUDIO_EXTENSIONS as readonly string[]).includes(ext);

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** The real format of a file from its first bytes, or null if it isn't audio. */
export function sniffAudio(bytes: Uint8Array): "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "wav";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    // MP4 containers also hold video, so only the audio brands count as music.
    return ["M4A ", "M4B ", "M4P ", "mp42", "isom", "dash"].includes(brand) ? "m4a" : null;
  }
  if (bytes[0] === 0xff) {
    const b = bytes[1];
    if ((b & 0xf6) === 0xf0) return "aac"; // ADTS: sync word with layer bits 00
    if ((b & 0xe0) === 0xe0 && (b & 0x06) !== 0) return "mp3"; // MPEG audio frame sync with a valid layer
  }
  return null;
}

function decodeText(bytes: Uint8Array): string {
  const encoding = bytes[0];
  const body = bytes.slice(1);
  let text: string;
  if (encoding === 1) text = new TextDecoder("utf-16").decode(body);
  else if (encoding === 2) text = new TextDecoder("utf-16be").decode(body);
  else if (encoding === 3) text = new TextDecoder("utf-8").decode(body);
  else text = new TextDecoder("latin1").decode(body);
  return text.replace(/\0+/g, " ").trim();
}

/** Title and artist from an ID3v2 tag, when the file has one. */
export function readId3(bytes: Uint8Array): { title: string | null; artist: string | null } {
  const out = { title: null as string | null, artist: null as string | null };
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return out;
  const version = bytes[3];
  if (version < 3) return out;
  const syncsafe = (i: number) => ((bytes[i] & 0x7f) << 21) | ((bytes[i + 1] & 0x7f) << 14) | ((bytes[i + 2] & 0x7f) << 7) | (bytes[i + 3] & 0x7f);
  const end = Math.min(bytes.length, 10 + syncsafe(6));
  let pos = 10;
  while (pos + 10 <= end) {
    const id = ascii(bytes, pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? syncsafe(pos + 4) : ((bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7]) >>> 0;
    if (size <= 0 || pos + 10 + size > end) break;
    if (id === "TIT2") out.title = decodeText(bytes.slice(pos + 10, pos + 10 + size)) || null;
    if (id === "TPE1") out.artist = decodeText(bytes.slice(pos + 10, pos + 10 + size)) || null;
    pos += 10 + size;
  }
  return out;
}

/** "03 - Rain_Sounds.mp3" reads better without its extension and underscores. */
export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim() || name;

/** Seconds as m:ss or h:mm:ss. */
export function formatTrackTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** A random item, avoiding `last` whenever there's another choice. */
export function pickDifferent<T>(items: T[], last: T | null, random: () => number = Math.random): T | null {
  if (!items.length) return null;
  const pool = items.length > 1 ? items.filter((i) => i !== last) : items;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
