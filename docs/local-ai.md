# Local AI assistant

An optional planning assistant that runs entirely on the user's computer. It's off by default (**Settings → AI assistant**), and Life OS works fully without it.

## How it works

1. The user sends a message or taps a quick prompt.
2. `src/ai/assistant/context.ts` builds a short context with only what that request needs: date and hours, the week's plans, goals, open tasks and scheduled sessions. Items get aliases (`g1`, `m2`, `t3`) instead of database ids, and notes, dreams, music, quotes and keys are never included.
3. The model answers with one JSON object. On desktop the engine enforces the shape with a grammar generated from `src/ai/assistant/schema.ts`. The `reply` field streams into the chat as it's written.
4. `parse.ts` checks the answer: the JSON must match the schema, aliases must exist, and dates must be real and not in the past. A broken answer gets one repair attempt, and a single bad operation is left out with a reason.
5. `proposals.ts` builds the preview using Life OS's own planning code: `sanitizePlan` and `effortCheck` from the Goal Compiler, `planGoalSessions` for weekly goal time, and the day scheduler (`proposeWeek`, `earliestSlot`) for sessions. The model never picks times. Completed, started and pinned work is never changed. (Blocks you moved by hand are pinned.)
6. The user applies, edits or cancels. `applyAssistantChangeSet` checks the preview is still current, then saves everything in one transaction through the repository. The chat only says something was saved after the save succeeds.

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
