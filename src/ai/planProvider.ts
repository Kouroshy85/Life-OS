/**
 * Optional AI integration for the Goal Compiler.
 *
 * The deterministic template compiler is always available. When the user has
 * configured an Anthropic API key, the model is asked for a plan in a strict
 * JSON shape; its answer is sanitised and labelled with the model id. Any
 * failure falls back to the template compiler and says so — a template plan is
 * never presented as model output.
 */

import { compileGoal, sanitizePlan, type CompiledPlan, type GoalRequest } from "../domain/goalCompiler";
import type { AiSettings } from "../persistence/repository";

export interface CompileOutcome {
  plan: CompiledPlan;
  /** Set when AI was configured but could not be used. */
  fallbackReason: string | null;
}

export function aiConfigured(ai: AiSettings): boolean {
  return ai.provider === "anthropic" && ai.apiKey.trim().length > 20 && ai.model.trim().length > 0;
}

export function aiStatusLabel(ai: AiSettings): string {
  return aiConfigured(ai) ? `Claude (${ai.model})` : "Built-in planner (no AI configured)";
}

const SYSTEM = `You turn a person's personal goal into a realistic, editable plan for a local planning app.
Return milestones in order. Each milestone has 1–3 projects; each project has 2–5 concrete, actionable tasks
that start with a verb and could each be finished in one sitting (15–240 minutes).
priority: 1 = low, 2 = medium, 3 = high, 4 = critical. energy: "low", "medium" or "high" (deep focus).
deadline: an ISO date (YYYY-MM-DD) after today for the milestone, or null.
Keep titles short (under 90 characters). Use the notes field for assumptions worth showing the user.`;

async function compileWithClaude(req: GoalRequest, ai: AiSettings, description: string): Promise<CompiledPlan> {
  const [{ default: Anthropic }, { zodOutputFormat }, { z }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("@anthropic-ai/sdk/helpers/zod"),
    import("zod"),
  ]);

  const PlanSchema = z.object({
    title: z.string(),
    description: z.string(),
    notes: z.array(z.string()),
    milestones: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        deadline: z.string().nullable(),
        projects: z.array(
          z.object({
            title: z.string(),
            tasks: z.array(
              z.object({
                title: z.string(),
                notes: z.string(),
                priority: z.number().int(),
                estimateMin: z.number().int(),
                energy: z.enum(["low", "medium", "high"]).nullable(),
              }),
            ),
          }),
        ),
      }),
    ),
  });

  // The key belongs to the user and stays on this device; the request goes straight to Anthropic.
  const client = new Anthropic({ apiKey: ai.apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 1 });
  const response = await client.messages.parse({
    model: ai.model.trim(),
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Goal: ${req.text.trim()}`,
          description.trim() ? `Context from the user: ${description.trim()}` : null,
          `Today: ${req.today}`,
          `Target date: ${req.targetDate ?? "none — pace it sensibly"}`,
          `Time available: about ${req.hoursPerWeek} hours per week`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(PlanSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("The model's answer was incomplete.");
  }
  return sanitizePlan(response.parsed_output, req, "ai", response.model);
}

export async function compilePlan(req: GoalRequest, ai: AiSettings, opts: { useAi: boolean; description?: string }): Promise<CompileOutcome> {
  if (!opts.useAi || !aiConfigured(ai)) {
    return { plan: compileGoal(req), fallbackReason: null };
  }
  try {
    return { plan: await compileWithClaude(req, ai, opts.description ?? ""), fallbackReason: null };
  } catch (e) {
    const message = describeError(e);
    return {
      plan: compileGoal(req),
      fallbackReason: `Claude couldn't be reached (${message}). This plan was made by the built-in planner instead.`,
    };
  }
}

function describeError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 401) return "the API key was rejected";
  if (status === 404) return "the model id was not found";
  if (status === 429) return "rate limited";
  if (status && status >= 500) return "the service is unavailable";
  if (e instanceof Error && /fetch|network/i.test(e.message)) return "no network connection";
  return e instanceof Error ? e.message.slice(0, 120).replace(/[.\s]+$/, "") : "unknown error";
}

/** Minimal request to confirm the key and model work. */
export async function testConnection(ai: AiSettings): Promise<{ ok: boolean; message: string }> {
  if (!aiConfigured(ai)) return { ok: false, message: "Add an API key and model first." };
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ai.apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 0 });
    // The models endpoint rejects webview origins (CORS), so check with the smallest possible message.
    const response = await client.messages.create({
      model: ai.model.trim(),
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, message: `Connected — ${response.model} is available.` };
  } catch (e) {
    return { ok: false, message: `Connection failed: ${describeError(e)}.` };
  }
}
