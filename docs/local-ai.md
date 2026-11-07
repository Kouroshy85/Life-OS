# Local AI assistant

An optional planning assistant that runs entirely on the user's computer. It's off by default (**Settings → AI assistant**), and Life OS works fully without it.

## How it works

1. The user sends a message, taps a quick prompt, or taps one of the answer buttons the assistant offered. A plain "yes" / "آره" / "باشه" or "no" / "نه" typed while a proposal is waiting applies or drops it right away, without asking the model (`confirm.ts`).
2. `dates.ts` writes the real date next to date words in the message ("آخر دی" → "آخر دی (2027-01-20)", "tomorrow", weekdays, "20 November"), because small models get calendar maths wrong, especially with Persian months. Persian digits become ordinary digits.
3. `src/ai/assistant/context.ts` builds a short context with only what that request needs: date and hours, the week's plans, goals, open tasks and scheduled sessions. Items get aliases (`g1`, `m2`, `t3`) instead of database ids, and notes, dreams, music, quotes and keys are never included.
4. The model answers with one JSON object. On desktop the engine enforces the shape with a grammar generated from `src/ai/assistant/schema.ts`, which also caps lengths (a 600-character reply, at most 5 operations, 4 milestones of 5 tasks). The `reply` streams into the chat as it's written: one sentence and a yes/no question for a proposal, one question with 2–4 tap-to-answer `choices` for a clarification.
5. `parse.ts` checks the answer: the JSON must match the schema, aliases must exist, and dates must be real and not in the past. A broken answer gets one repair attempt, and so does a proposal that arrives with no operations. A single bad operation is left out with a reason.
6. `proposals.ts` drops copies of existing open tasks, goals and milestones (titles compared loosely, so "Practice" matches "Practise"), then builds the preview using Life OS's own planning code: `sanitizePlan` and `effortCheck` from the Goal Compiler, `planGoalSessions` for weekly goal time, and the day scheduler (`proposeWeek`, `earliestSlot`) for sessions. The model never picks times. Completed, started and pinned work is never changed. (Blocks you moved by hand are pinned.)
7. The proposal shows as a compact card: a title, one line on what changes, and **Yes, apply** / **No** (details fold away). Yes saves straight away, with no second dialog. `applyAssistantChangeSet` checks the preview is still current, then saves everything in one transaction through the repository. The chat only says something was saved after the save succeeds.

## Files

| Area | Files |
|---|---|
| Prompt, context, schema, parsing, previews, apply | `src/ai/assistant/` |
| Model providers (desktop engine, unavailable stub, test mock) | `src/ai/providers/` |
| Chat state and the confirm flow | `src/state/assistant.ts` |
| Interface | `src/features/assistant/` and `src/styles/assistant.css` |
| Conversation storage | migration 5 (`ai_conversations`, `ai_messages`) in `src/persistence/migrations.ts` |
| Desktop engine | `src-tauri/src/ai/` (llama.cpp through the `llama-cpp-2` crate) |

The system prompt lives in `src/ai/assistant/systemPrompt.ts` with a `PROMPT_VERSION`. Every assistant message stores the prompt version and model it came from.

## The engine and its commands

The desktop app runs llama.cpp inside the Rust backend. There's no local server or open port, and the frontend reaches it only through these Tauri commands:

`ai_status`, `ai_models`, `ai_load`, `ai_unload`, `ai_set_idle_unload`, `ai_generate` (streams tokens over a Channel), `ai_cancel`, `ai_import_model`, `ai_download_model`, `ai_delete_model`.

Errors come back as `{ code, message }`, with these codes: `model_missing`, `insufficient_memory`, `load_failed`, `generation_failed`, `cancelled`, `invalid_model`, `download_failed`. The web app and phone builds use the unavailable provider and say so in the interface. A phone engine can be added later behind the same commands without changing the TypeScript.

## Models

| Model | File | Download | Memory |
|---|---|---|---|
| Qwen3.5-2B (default) | Q4_K_M GGUF | about 1.3 GB | about 3 GB free |
| Qwen3.5-4B (higher quality) | Q4_K_M GGUF | about 2.7 GB | about 5 GB free |

- **Storage:** model files are never bundled into the installer. They live in `%APPDATA%\app.lifeos.desktop\models\`.
- **Getting one:** the user downloads a model once from Settings, or chooses a GGUF file they already have. After that, nothing needs the internet.
- **Requirements:** Qwen3.5 uses a hybrid Gated-DeltaNet design, so the engine needs a llama.cpp build from b8233 or later.
- **Licences:** both models are Apache-2.0 (confirm on the model card before release).

### 2B or 4B (measured 2026-11-05)

Ryzen 9 4900HS (8 cores), 16 GB, CPU only, release build, the app's real system prompt and schema, 8 requests in English and Persian (about 1,500 prompt tokens each):

| | 2B | 4B |
|---|---|---|
| Load | 3.4 s | 5.6 s |
| Wait before the first token | 10–11 s | 23–29 s |
| Writing speed | 18 tokens/s | 8.4 tokens/s |
| Typical full answer | 15–50 s | 36–80 s ("plan my week": 3.5 min) |
| Long prompt (~2,700 tokens) | 29 s | 68 s |
| Peak memory | 2.1 GB | 4.5 GB |
| Valid JSON | 8 of 8 | 8 of 8 |

Both refused the off-topic request and asked about the vague one. The 4B was clearly smarter: it noticed an exam date that conflicted with the goal's date, gave a concrete next step when overwhelmed, respected a pinned block and asked before guessing. The 2B made plan-level mistakes: it attached a weight-loss milestone to the IELTS goal, duplicated existing tasks and proposed moving a pinned block (which the preview refuses).

**Decision:** 2B stays the default, because it's 2–2.5 times faster and fits PCs with 8 GB. 4B stays as the optional "smarter, slower" model for PCs with 16 GB, and Settings says so. Both models still duplicate existing tasks sometimes, which the prompt and context should address.

### Instruction v1 vs v2 (measured 2026-11-07, Qwen3.5-2B)

20 requests, 10 English and 10 Persian, against the test fixture (an IELTS goal, a started essay, a pinned tutor call and a gym routine): plan my week; an exam date that conflicts with the goal; a new 5K goal; "get fit"; overwhelmed; an off-topic coding request; moving the pinned call; moving a task to "tomorrow evening"; a follow-up answer to an earlier question; adding a 20-minute task; and in Persian a weight-loss goal "by the end of Dey", a math exam on "20 November", "organize today", "do something for me", IELTS on "Monday and Wednesday evening", the dollar price, feeling overwhelmed, a follow-up of "4 hours a week", moving the pinned call, and adding a 45-minute task. Each answer is scored on 11–17 automatic checks (valid answer, right intent, user's language, no clock times, short, one question, ends by asking to apply, has operations, answer buttons on questions, no copies, protected work untouched, at most 5 operations, plus case checks such as the right date or weekdays).

| | v1 | v2 (final wording) | v2, best run |
|---|---|---|---|
| Checks passed | 80% (210/264) | 90% (242/269) | 93% (249/268) |
| Cases with every check passed | 1 of 20 | 7 of 20 | 9 of 20 |
| Average answer length | 409 tokens | 318 tokens | 245–314 tokens |
| Long or rambling replies | 6 | 0 | 0 |
| Clock times in replies | 6 | 0 | 0–1 |

The same wording varies by about ±3 points between runs (temperature 0.3), so the final wording was picked for what it got wrong, not its single best score. Examples written into the instruction get copied by 2B (a "guitar goal" appeared in a Persian day plan), so the final wording only shows the closing question. What's still weak on 2B: it sometimes adds a task as a new milestone instead of a task under the goal, it still tries to move a pinned block when asked (Life OS blocks it), it doesn't reliably use `propose_weekly_schedule` for weekday requests, and it sometimes proposes copies of existing tasks (Life OS leaves them out). The app-side checks (duplicates dropped, protected work blocked, one retry for an empty proposal, dates worked out in code) are what keep those from reaching the Yes button.

## Building the engine on Windows

`llama-cpp-sys-2` compiles llama.cpp from source and needs:

- the Visual Studio 2022 Build Tools with CMake (already on the build PC)
- **libclang**, for bindgen: the Visual Studio "C++ Clang tools" component or LLVM

The first build is CPU-only. GPU builds (Vulkan or CUDA) can come later as an optional feature.

## Tests

`npx vitest run` covers the assistant with a scripted model, so no real model is needed:
- **`parse.test.ts`:** schema, aliases, dates, wrong intent and repair.
- **`proposals.test.ts`:** goals, milestones, tasks, protected work, week planning around pinned and finished blocks, rescheduling, stale previews, and single-transaction saves including rollback.
- **`conversation.test.ts`:** English and Persian, out of scope, clarification, repair, cut-off and stopped generation, provider errors, no network use, and prompt-injection markers.
- **`repository.test.ts`:** conversation storage and the upgrade to schema 5.
