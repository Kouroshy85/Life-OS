import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../../domain/locale";
import { en } from "../../i18n/en";
import { fa } from "../../i18n/fa";
import { t } from "../../i18n";
import type { ChatMessage } from "../../persistence/repository";
import { historyTurns } from "./conversation";
import { decodeNote, encodeNote, messageText } from "./messages";

afterEach(() => setLang("en"));

const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: content,
  conversationId: "c",
  role,
  content,
  intent: null,
  model: null,
  promptVersion: null,
  proposal: null,
  proposalStatus: null,
  createdAt: "",
});

describe("app notes in the chat", () => {
  const saved = encodeNote({ k: "saved", goals: ["IELTS"], goalIds: ["g"], milestones: 3, tasks: 9, updated: 0, sessions: 2, rescheduled: 0 });

  it("reads in the language the app is in now, not when it was saved", () => {
    expect(messageText(msg("note", saved), t)).toBe(en.aiSaved(["IELTS"], 3, 9, 0, 2, 0));
    setLang("fa");
    expect(messageText(msg("note", saved), t)).toBe(fa.aiSaved(["IELTS"], 3, 9, 0, 2, 0));
  });

  it("keeps plain text and older messages as they are", () => {
    expect(messageText(msg("assistant", "Here's a plan."), t)).toBe("Here's a plan.");
    expect(decodeNote('{"k": not json')).toBeNull();
  });

  it("tells the model about rebuilt previews in English, whatever the app language", () => {
    setLang("fa");
    const turns = historyTurns([msg("user", "سلام"), msg("assistant", encodeNote({ k: "stale" }))]);
    expect(turns[1].content).toBe(en.aiStaleRebuilt);
  });
});
