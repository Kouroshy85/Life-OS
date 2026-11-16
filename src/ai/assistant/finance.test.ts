import { describe, expect, it } from "vitest";
import { draft, financeState, financeTransaction } from "../../domain/finance/fixtures";
import type { FinanceCommand } from "../../domain/finance/types";
import { accountBalance } from "../../domain/finance/service";
import { FinanceRepository, financeFingerprint } from "../../persistence/financeRepository";
import { migrate } from "../../persistence/migrations";
import { createMemoryDriver } from "../../persistence/sqljsDriver";
import { createMockProvider } from "../providers/mock";
import { unavailableProvider } from "../providers/unavailable";
import { buildContext, classifyRequest } from "./context";
import { runTurn } from "./conversation";
import { buildFinanceContext, financePreview, resolveFinanceCommand } from "./finance";
import { answer, CLOCK, sampleContext, sampleState } from "./fixtures";
import { parseResponse } from "./parse";
import { buildChangeSet, isStale } from "./proposals";
import { responseJsonSchema } from "./schema";

const expense: FinanceCommand = { entity: "transaction", value: { ...draft(financeTransaction()), id: null } };
describe("Finance assistant capability", () => {
  it("routes Finance, Planning and mixed requests and never sends Finance facts to a planning-only turn", () => {
    expect(classifyRequest("Analyze my spending this month")).toBe("finance");
    expect(classifyRequest("بودجه غذا رو بیشتر کن")).toBe("finance");
    expect(classifyRequest("Plan my week")).toBe("week");
    expect(classifyRequest("Help me save for a PC while organizing my goals")).toBe("mixed");
    const source = { ...sampleContext(), finance: financeState() };
    expect(buildContext(source, "finance").text).not.toContain("IELTS");
    expect(buildContext(source, "week").text).not.toContain("Finance facts");
    expect(buildContext(source, "mixed").text).toContain("IELTS");
    expect(buildContext(source, "mixed").text).toContain("Finance facts");
  });
  it("generates bounded summaries with all-record totals, currency scales and alias-only references", () => {
    const s = financeState(); s.transactions = Array.from({ length: 40 }, (_, i) => financeTransaction({ id: `t${i}` }));
    const built = buildFinanceContext(s, CLOCK.today);
    expect(built.text).toContain('"expensesMinor":40000');
    expect(Object.keys(built.aliases).filter((a) => a.startsWith("ft"))).toHaveLength(12);
    expect(built.text).not.toContain('"accountId":"a1"');
    expect(built.text).not.toContain("opening_minor");
    s.transactions[0].notes = "long".repeat(100); expect(Object.values(buildFinanceContext(s, CLOCK.today).aliases)).not.toContain("t0");
  });
  it("resolves only exposed references and rejects invented ids and direct SQL", () => {
    const built = buildFinanceContext(financeState(), CLOCK.today);
    if (expense.entity !== "transaction") throw new Error();
    const aliases = built.aliases, account = Object.keys(aliases).find((key) => aliases[key] === "a1")!, category = Object.keys(aliases).find((key) => aliases[key] === "food")!;
    const command = { ...expense, value: { ...expense.value, accountId: account, categoryId: category } };
    expect(resolveFinanceCommand(command, aliases)).toEqual(expense);
    expect(() => resolveFinanceCommand(expense, aliases)).toThrow(/reference/);
    expect(responseJsonSchema()).toContain('"finance"');
    const parsed = parseResponse(answer({ intent: "propose_changes", operations: [{ type: "finance", command }], proposal: { summary: "Lunch" } }), { goals: {}, milestones: {}, tasks: {}, finance: aliases }, CLOCK.today);
    expect(parsed.ok && parsed.operations[0]).toEqual({ type: "finance", command: expense });
    expect(parseResponse(JSON.stringify({ intent: "propose_changes", reply: "x", needs_clarification: false, clarification: null, choices: [], proposal: null, operations: [{ type: "finance", command: { sql: "DELETE FROM finance_accounts" } }] }), { goals: {}, milestones: {}, tasks: {} }, CLOCK.today).ok).toBe(false);
  });
  it("never permits changes on a read-only advice response", () => {
    const parsed = parseResponse(answer({ operations: [{ type: "finance", command: expense }] }), { goals: {}, milestones: {}, tasks: {} }, CLOCK.today);
    expect(parsed.ok && parsed.operations).toEqual([]); expect(parsed.ok && parsed.rejected[0].code).toBe("wrong_intent");
  });
  it("previews exact amounts before saving, rejects invalid commands, and detects changed facts", () => {
    const state = sampleState({ finance: financeState() });
    const cs = buildChangeSet([{ type: "finance", command: expense }], state, CLOCK, { summary: "Lunch", model: "test" });
    expect(cs.items[0].kind).toBe("finance"); expect(state.finance!.transactions).toEqual([]);
    expect(financePreview(expense, state.finance!).join(" ")).toContain("10.00 USD");
    state.finance!.transactions.push(financeTransaction()); expect(isStale(cs, state)).toBe(true);
    if (expense.entity !== "transaction") throw new Error();
    const bad = buildChangeSet([{ type: "finance", command: { ...expense, value: { ...expense.value, accountId: "missing" } } }], state, CLOCK, { summary: "bad", model: null });
    expect(bad.items).toEqual([]); expect(bad.rejected).toHaveLength(1);
  });
  it("validates combined allocations against each other before offering approval", () => {
    const s = financeState(); s.goals.push({ id: "g", name: "PC", currency: "USD", scale: 2, targetMinor: 10000, targetDate: null, description: "", status: "active", accountId: null, createdAt: "x", updatedAt: "x" });
    const state = sampleState({ finance: s });
    const cs = buildChangeSet([1000, -1001].map((amountMinor) => ({ type: "finance" as const, command: { entity: "contribution" as const, value: { id: null, goalId: "g", amountMinor, date: "2026-11-14", notes: "" } } })), state, CLOCK, { summary: "Savings", model: null });
    expect(cs.items).toHaveLength(1); expect(cs.rejected).toHaveLength(1);
  });
  it("read-only analytics need no proposal and work with a scripted local model", async () => {
    const s = financeState(); s.transactions.push(financeTransaction());
    const source = { ...sampleContext(), finance: s };
    const provider = createMockProvider([answer({ reply: "You spent USD 10.00 this month." })]);
    const result = await runTurn({ provider, history: [], userText: "What did I spend this month?", kind: "finance", source, lang: "en" });
    expect(result.status === "ok" && result.operations).toEqual([]);
    expect(provider.requests[0].system).toContain("FINANCE MODULE");
    expect(provider.requests[0].messages.at(-1)!.content).toContain('"expensesMinor":1000');
  });
  it("proposes but does not persist financial changes until the approved repository commit", async () => {
    const db = await createMemoryDriver(); await migrate(db); const repo = new FinanceRepository(db);
    const s = await repo.commit([{ entity: "account", value: { id: null, name: "Bank", currency: "USD", scale: 2, openingMinor: 10000, type: "bank", description: "", archived: false } }]);
    const built = buildFinanceContext(s, CLOCK.today);
    const accountId = Object.keys(built.aliases).find((a) => built.aliases[a] === s.accounts[0].id)!;
    const categoryId = Object.keys(built.aliases).find((a) => built.aliases[a] === "finance-food")!;
    if (expense.entity !== "transaction") throw new Error();
    const command = { ...expense, value: { ...expense.value, accountId, categoryId } };
    const provider = createMockProvider([answer({ intent: "propose_changes", reply: "Add lunch?", proposal: { summary: "Lunch" }, operations: [{ type: "finance", command }] })]);
    const result = await runTurn({ provider, history: [], userText: "Add a USD 10 lunch expense", kind: "finance", source: { ...sampleContext(), finance: s }, lang: "en" });
    expect(result.status).toBe("ok"); expect((await repo.load()).transactions).toEqual([]);
    if (result.status !== "ok" || result.operations[0].type !== "finance") throw new Error();
    const saved = await repo.commit([result.operations[0].command], financeFingerprint(s));
    expect(saved.transactions).toHaveLength(1); expect(accountBalance(saved, s.accounts[0].id)).toBe(9000);
  });
  it("keeps the independent Finance domain usable when the AI provider is unavailable", async () => {
    const s = financeState();
    const result = await runTurn({ provider: unavailableProvider, history: [], userText: "Analyze spending", kind: "finance", source: { ...sampleContext(), finance: s }, lang: "en" });
    expect(result.status).toBe("error"); expect(accountBalance(s, "a1")).toBe(10000);
  });
});
