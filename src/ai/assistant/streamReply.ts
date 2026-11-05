/**
 * Pulls the "reply" text out of a JSON answer that is still being written, so the
 * chat can show the assistant's words as they arrive.
 */
export function partialReply(json: string): string {
  const key = /"reply"\s*:\s*"/.exec(json);
  if (!key) return "";
  let out = "";
  for (let i = key.index + key[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) return out;
    if (next === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "", b: "", f: "", '"': '"', "\\": "\\", "/": "/" } as Record<string, string>)[next] ?? next;
    i += 1;
  }
  return out;
}
