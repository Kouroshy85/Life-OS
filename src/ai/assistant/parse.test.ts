import { describe, expect, it } from "vitest";
import { buildContext } from "./context";
import { answer, CLOCK, goalOperation, sampleContext } from "./fixtures";
import { parseResponse } from "./parse";
import { responseJsonSchema } from "./schema";

const { aliases, text: contextText } = buildContext(sampleContext(), "general");
const parse = (text: string) => parseResponse(text, aliases, CLOCK.today);

describe("parsing assistant answers", () => {
  it("accepts plain advice", () => {
    const r = parse(answer({ reply: "Start with the hardest task while you're fresh." }));
    expect(r.ok && r.response.intent).toBe("advice");
    expect(r.ok && r.operations).toEqual([]);
  });

  it("accepts Persian replies", () => {
    const r = parse(answer({ reply: "اول سخت‌ترین کار رو انجام بده." }));
    expect(r.ok && r.response.reply).toBe("اول سخت‌ترین کار رو انجام بده.");
  });

  it("rejects text that isn't JSON", () => {
    const r = parse("Sure! Here's your plan: …");
    expect(r.ok).toBe(false);
  });

  it("rejects unknown operation types", () => {
    const r = parse(answer({ intent: "propose_changes", operations: [{ type: "delete_goal", goal_ref: "g1" } as never] }));
    expect(r.ok).toBe(false);
  });

  it("rejects impossible durations", () => {
    const op = goalOperation();
    op.milestones[0].tasks[0].estimate_min = 2000;
    expect(parse(answer({ intent: "propose_changes", operations: [op as never] })).ok).toBe(false);
  });

  it("rejects unexpected fields, so the model can't smuggle in extra instructions", () => {
    expect(parse(answer({ sql: "DROP TABLE goals" } as never)).ok).toBe(false);
  });

  it("drops changes attached to advice or out-of-scope answers", () => {
    for (const intent of ["advice", "out_of_scope"] as const) {
      const r = parse(answer({ intent, operations: [goalOperation() as never] }));
      expect(r.ok && r.operations).toEqual([]);
      expect(r.ok && r.rejected[0].code).toBe("wrong_intent");
    }
  });

  it("treats a question as a clarification, whatever the intent says", () => {
    const r = parse(answer({ intent: "advice", needs_clarification: true, clarification: "When is your exam?" }));
    expect(r.ok && r.response.intent).toBe("clarification");
  });

  it("resolves aliases from the context to real ids", () => {
    expect(contextText).toContain("t1");
    const ref = Object.entries(aliases.tasks).find(([, id]) => id === "task-listen")![0];
    const r = parse(
      answer({
        intent: "propose_changes",
        proposal: { summary: "Shorter session" },
        operations: [{ type: "update_task", task_ref: ref, changes: { title: null, notes: null, estimate_min: 45, priority: null, energy: null, deadline: null } }],
      }),
    );
    expect(r.ok && r.operations[0]).toEqual({ type: "update_task", taskId: "task-listen", changes: { estimateMin: 45 } });
  });

  it("rejects aliases that weren't in the context", () => {
    const r = parse(
      answer({
        intent: "propose_changes",
        operations: [{ type: "propose_reschedule", task_ref: "t99", target_date: "2026-11-06", time_of_day: "any" }],
      }),
    );
    expect(r.ok && r.rejected[0]).toMatchObject({ code: "unknown_ref", detail: "t99" });
  });

  it("rejects past and impossible dates", () => {
    const past = parse(answer({ intent: "propose_changes", operations: [goalOperation({ target_date: "2026-10-01" }) as never] }));
    expect(past.ok && past.rejected[0].code).toBe("past_date");
    const fake = parse(answer({ intent: "propose_changes", operations: [goalOperation({ target_date: "2026-02-30" }) as never] }));
    expect(fake.ok && fake.rejected[0].code).toBe("bad_date");
  });

  it("rejects milestone deadlines after the goal's target date", () => {
    const op = goalOperation({ target_date: "2026-11-20" });
    op.milestones[0].deadline = "2026-12-01" as never;
    const r = parse(answer({ intent: "propose_changes", operations: [op as never] }));
    expect(r.ok && r.rejected[0].code).toBe("after_target");
  });

  it("produces a grammar schema without regex patterns", () => {
    const schema = responseJsonSchema();
    expect(schema).not.toContain('"pattern"');
    expect(JSON.parse(schema).properties.operations).toBeDefined();
  });
});
