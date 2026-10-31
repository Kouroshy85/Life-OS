import { describe, expect, it } from "vitest";
import { extensionOf, formatTrackTime, isAudioExtension, pickDifferent, readId3, sniffAudio, titleFromFileName } from "./audioFormat";
import { planGoalSessions, replanGoalSessions } from "./goalPlanner";
import { overlaps } from "./intervals";
import { ALL_DAYS, dayBit } from "./plans";
import { DEFAULT_PREFERENCES, type Plan } from "./types";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  while (out.length < 32) out.push(0);
  return new Uint8Array(out);
};

describe("recognising real audio", () => {
  it("accepts each real format from its first bytes", () => {
    expect(sniffAudio(bytes("ID3", [4, 0, 0]))).toBe("mp3");
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
    expect(sniffAudio(bytes("fLaC"))).toBe("flac");
    expect(sniffAudio(bytes("OggS"))).toBe("ogg");
    expect(sniffAudio(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("wav");
    expect(sniffAudio(bytes([0, 0, 0, 32], "ftypM4A "))).toBe("m4a");
    expect(sniffAudio(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe("aac");
  });

  it("rejects things pretending to be audio", () => {
    expect(sniffAudio(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffAudio(bytes("MZ"))).toBeNull(); // a program renamed to .mp3
    expect(sniffAudio(bytes("PK", [3, 4]))).toBeNull(); // a zip
    expect(sniffAudio(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull(); // a video in the same wrapper as WAV
    expect(sniffAudio(bytes([0, 0, 0, 32], "ftypqt  "))).toBeNull(); // a QuickTime video
    expect(sniffAudio(bytes("just some text in a file"))).toBeNull();
    expect(sniffAudio(new Uint8Array(4))).toBeNull();
  });

  it("checks extensions case-insensitively", () => {
    expect(extensionOf("Song.MP3")).toBe("mp3");
    expect(extensionOf("noext")).toBe("");
    expect(isAudioExtension("flac")).toBe(true);
    expect(isAudioExtension("exe")).toBe(false);
  });
});

describe("track details", () => {
  const frame = (id: string, text: number[]) => {
    const size = text.length;
    return [...id].map((c) => c.charCodeAt(0)).concat([0, 0, (size >> 7) & 0x7f, size & 0x7f, 0, 0], text);
  };

  it("reads title and artist from ID3 tags, including Persian in UTF-8 and UTF-16", () => {
    const utf8 = [3, ...new TextEncoder().encode("باران")];
    const utf16 = [1, 0xff, 0xfe, ...[..."Sara"].flatMap((c) => [c.charCodeAt(0), 0])];
    const body = [...frame("TIT2", utf8), ...frame("TPE1", utf16)];
    const tag = new Uint8Array([..."ID3"].map((c) => c.charCodeAt(0)).concat([4, 0, 0, 0, 0, (body.length >> 7) & 0x7f, body.length & 0x7f], body));
    expect(readId3(tag)).toEqual({ title: "باران", artist: "Sara" });
  });

  it("copes with missing or damaged tags", () => {
    expect(readId3(new Uint8Array(20))).toEqual({ title: null, artist: null });
    expect(readId3(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f, 0xff, 0xff]))).toEqual({ title: null, artist: null });
  });

  it("makes a readable title from a file name", () => {
    expect(titleFromFileName("Rain_Sounds_Long.mp3")).toBe("Rain Sounds Long");
    expect(titleFromFileName("a.b.flac")).toBe("a.b");
  });

  it("formats track time", () => {
    expect(formatTrackTime(5)).toBe("0:05");
    expect(formatTrackTime(185)).toBe("3:05");
    expect(formatTrackTime(3725)).toBe("1:02:05");
    expect(formatTrackTime(NaN)).toBe("0:00");
  });

  it("picks a different quote each time when it can", () => {
    expect(pickDifferent(["a", "b"], "a")).toBe("b");
    expect(pickDifferent(["a"], "a")).toBe("a");
    expect(pickDifferent([], null)).toBeNull();
  });
});

describe("decreasing a goal's hours", () => {
  const SUNDAY = "2026-11-01";
  const prefs = DEFAULT_PREFERENCES;
  const base = (p: Partial<Plan>): Plan => ({
    id: p.id ?? "x", type: "default", title: "x", description: "", weekdays: ALL_DAYS, dates: null, validFrom: null,
    start: 540, end: 1020, goalId: null, isBreak: false, isSample: false, createdAt: "x", updatedAt: "x", ...p,
  });
  const asPlans = (goalId: string, sessions: ReturnType<typeof planGoalSessions>["sessions"]): Plan[] =>
    sessions.map((s, i) => base({ id: `${goalId}-${i}`, type: "goal", goalId, weekdays: dayBit(s.weekday), start: s.start, end: s.end }));

  it("replaces only that goal's sessions, at exactly the new hours", () => {
    const work = base({ id: "work" });
    const other = asPlans("other", planGoalSessions({ hoursMin: 3, hoursMax: 3, plans: [work], prefs, today: SUNDAY }).sessions);
    const mine = asPlans("mine", planGoalSessions({ hoursMin: 9, hoursMax: 9, plans: [work, ...other], prefs, today: SUNDAY }).sessions);
    const r = replanGoalSessions({ goalId: "mine", hours: 5, plans: [work, ...other, ...mine], prefs, today: SUNDAY });
    expect(r.ok).toBe(true);
    expect(r.placedMin).toBe(300);
    for (const s of r.sessions) {
      for (const p of [...other, work]) {
        if (p.weekdays & dayBit(s.weekday)) expect(overlaps(s, p)).toBe(false);
      }
    }
  });

  it("can reuse the time the goal is giving up, even in a full week", () => {
    const blocked = base({ id: "full", start: 360, end: 1440 });
    const mineSlot = base({ id: "mine-0", type: "goal", goalId: "mine", weekdays: dayBit(0), start: 1440 - 120, end: 1440 });
    const allowed = base({ ...blocked, weekdays: ALL_DAYS - dayBit(0) });
    const sunday = base({ id: "sun", weekdays: dayBit(0), start: 360, end: 1440 - 180 });
    const r = replanGoalSessions({ goalId: "mine", hours: 1, plans: [allowed, sunday, mineSlot], prefs: { ...prefs, planGap: false, sleepStart: 0, wakeTime: 360 }, today: SUNDAY });
    expect(r.ok).toBe(true);
    expect(r.sessions[0].weekday).toBe(0);
  });

  it("reports failure instead of keeping fewer hours than asked", () => {
    const full = base({ id: "full", start: 360, end: 1440 });
    const r = replanGoalSessions({ goalId: "mine", hours: 5, plans: [full], prefs: { ...prefs, planGap: false, sleepStart: 0, wakeTime: 360 }, today: SUNDAY });
    expect(r.ok).toBe(false);
  });
});
