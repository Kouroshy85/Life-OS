import { decodeParts } from "../domain/explain";
import { getLang } from "../domain/locale";
import { en, type Dict } from "./en";
import { fa } from "./fa";

const DICTS = { en, fa };

/** Strings for the current language. Always read at render or call time, never cached in a constant. */
export const t = new Proxy({} as Dict, {
  get: (_, key) => DICTS[getLang()][key as keyof Dict],
});

/** Renders a stored explanation. Text saved before explanations became data is shown unchanged. */
export function explain(encoded: string | null | undefined): string {
  if (!encoded) return "";
  const parts = decodeParts(encoded);
  return parts ? parts.map((p) => t.part(p)).join(" ") : encoded;
}
