# Life OS

A local-first personal planning desktop app. Two things, done properly:

- **Goal Compiler** turns a goal written in your own words into milestones, projects and tasks you can edit, reorder, complete and revise without losing progress.
- **Adaptive Day Planner** turns tasks and fixed commitments into a realistic day, explains every placement, and recalculates when reality changes.

No account, no cloud sync. Data lives in a SQLite file on your device.

## Requirements

- Node.js 22+ and npm
- For the desktop app: Rust (stable) and, on Windows, the MSVC Build Tools and WebView2 (see the [Tauri prerequisites](https://tauri.app/start/prerequisites/))

## Run it

```bash
npm install
```

Desktop app (native window, native SQLite):

```bash
npm run app:dev
```

Installer and release executable, written to `src-tauri/target/release/`:

```bash
npm run app:build
```

UI only in a browser, for quick iteration (SQLite compiled to WebAssembly, stored in IndexedDB):

```bash
npm run dev
```

## Test

```bash
npm test
npm run typecheck
```

## Optional: Claude for goal drafting

Nothing is required: without a key the deterministic **built-in planner** compiles goals from recognised goal types.

To use Claude, open **Settings → AI assistance**, choose Anthropic, paste an API key, then **Test connection**.

- Only the goal text, context, dates and weekly hours are sent, and only when you compile or revise with the Claude switch on.
- Every plan shows where it came from. If a request fails, the built-in planner takes over and says so; template output is never labelled as a model's.
- The key is stored unencrypted in the local database on this device. Moving it to the OS keychain is a sensible next step.
- Scheduling never uses a model.

## Architecture

```
src/
  domain/       Pure logic, no I/O: scheduler, goal compiler, revision merge, time, intervals
  state/        planning.ts (engine <-> stored days), store.ts (app actions and state)
  persistence/  SqlDriver interface, tauri + sql.js drivers, migrations, repository
  ai/           Optional Claude provider, always falling back to the domain compiler
  ui/           Primitives and the LiquidGlass material
  features/     today, goals, planner, settings, shell
src-tauri/      Native shell and a small SQLite bridge (rusqlite)
```

Key decisions:

- **The scheduler is a pure function.** It takes a snapshot, including the current minute, and returns blocks plus explanations. It reads no clock and uses no randomness, so the same input always gives the same plan.
- **One schema, two engines.** Migrations and queries live in TypeScript. The native driver and the WebAssembly driver run identical SQL, so tests exercise the real schema.
- **Migrations use `PRAGMA user_version`.** Each runs in a transaction with its version bump, so a failure leaves the database at the previous version. Databases from a newer app are refused rather than risked.
- **Proposals don't touch your plan.** "Plan day" writes separate proposed blocks; only Accept replaces the live plan. Overruns and commitment changes apply immediately instead, because the existing plan would otherwise be invalid.
- **Glass is for controls.** Refraction uses a size-specific SVG displacement map inside `backdrop-filter` on the sidebar, toolbar, dialogs and menus. Engines without support get a frosted blur. Reading surfaces stay opaque enough to read.

## How scheduling works

1. The window is your working hours, clipped to the current time when planning today.
2. Commitments, breaks, and started, finished or pinned blocks are subtracted.
3. Tasks are ranked by deadline urgency and priority, with deterministic tie-breaks.
4. Each task takes the earliest suitable slot. Deep-focus work prefers focus hours and low-energy work avoids them. A buffer follows each task, and breaks are inserted after long runs.
5. A task too long for any gap is split into sessions no shorter than your minimum.
6. Anything left stays in the backlog with its reason.

Overdue tasks go first with a warning, and same-day deadlines that can't be met are flagged rather than dropped. Hand-moved blocks are pinned and stay put, unless a commitment or running task collides with them. Dragging can never create an overlap: the block snaps to the nearest free slot and tells you why.

## Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl 1` / `2` / `3` | Today / Goals / Planner |
| `Ctrl ,` | Settings |
| `Ctrl N` | New goal |
| `←` / `→` | Previous / next day (Planner) |
| `T` / `P` | Jump to today / propose a plan (Planner) |
| `↑` / `↓` on a block | Move 5 min (`Shift`: 15 min, `Alt`: resize) |
| `Space` then `↑` / `↓` on a task handle | Reorder a task |
| `Esc` | Close dialogs and menus |
