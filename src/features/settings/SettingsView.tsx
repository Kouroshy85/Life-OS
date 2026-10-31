import { Database, KeyRound, Keyboard, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { aiConfigured, aiStatusLabel, testConnection } from "../../ai/planProvider";
import { loadSampleData, removeSampleData, resetAll, saveAi, savePrefs, useApp, validatePrefs } from "../../state/store";
import { SelectInput, TextInput } from "../../ui/fields";
import { Button, Confirm, Field } from "../../ui/primitives";
import { PrefsFields } from "../planner/PrefsForm";

export function SettingsView() {
  const prefs = useApp((s) => s.prefs);
  const ai = useApp((s) => s.ai);
  const engine = useApp((s) => s.engine);
  const location = useApp((s) => s.location);
  const hasSample = useApp((s) => s.goals.some((g) => g.isSample) || s.tasks.some((t) => t.isSample) || s.commitments.some((c) => c.id.startsWith("sample-")));

  const [draft, setDraft] = useState(prefs);
  useEffect(() => setDraft(prefs), [prefs]);
  const prefsError = validatePrefs(draft);
  const prefsDirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  const [aiDraft, setAiDraft] = useState(ai);
  useEffect(() => setAiDraft(ai), [ai]);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            Settings
          </h1>
        </div>
      </div>

      <section className="card settings-section rise" aria-labelledby="set-plan">
        <h2 className="settings-section__title" id="set-plan">
          <SlidersHorizontal size={17} /> Planning
        </h2>
        <PrefsFields value={draft} onChange={setDraft} />
        <div className="settings-section__foot">
          {prefsError && <span className="field__error">{prefsError}</span>}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" disabled={!prefsDirty} onClick={() => setDraft(prefs)}>
            Discard
          </Button>
          <Button variant="primary" disabled={!prefsDirty || !!prefsError} onClick={() => savePrefs(draft)}>
            Save planning preferences
          </Button>
        </div>
      </section>

      <section className="card settings-section rise rise-1" aria-labelledby="set-ai">
        <h2 className="settings-section__title" id="set-ai">
          <Sparkles size={17} /> AI assistance <span className={`badge-source ${aiConfigured(ai) ? "badge-source--ai" : ""}`} style={{ marginLeft: 8 }}>{aiStatusLabel(ai)}</span>
        </h2>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: 680 }}>
          Optional. When configured, the Goal Compiler can ask Claude to draft plans. Scheduling is always done by Life OS's own deterministic engine. Without a key, the built-in planner is used — and plans are always labelled with where they came from.
        </p>
        <div className="field-row" style={{ gridTemplateColumns: "200px 1fr 1fr" }}>
          <Field label="Provider">
            <SelectInput value={aiDraft.provider} onChange={(e) => setAiDraft({ ...aiDraft, provider: e.target.value as typeof aiDraft.provider })}>
              <option value="none">None (built-in planner)</option>
              <option value="anthropic">Anthropic Claude</option>
            </SelectInput>
          </Field>
          <Field label="API key" hint="Stored in the local database on this device only.">
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              disabled={aiDraft.provider === "none"}
              value={aiDraft.apiKey}
              onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })}
            />
          </Field>
          <Field label="Model">
            <TextInput disabled={aiDraft.provider === "none"} value={aiDraft.model} spellCheck={false} onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })} />
          </Field>
        </div>
        <div className="settings-section__foot">
          {test && <span className={test.ok ? "chip chip--success" : "field__error"}>{test.message}</span>}
          <span style={{ flex: 1 }} />
          <Button
            variant="glass"
            disabled={testing || !aiConfigured(aiDraft)}
            onClick={async () => {
              setTesting(true);
              setTest(await testConnection(aiDraft));
              setTesting(false);
            }}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="primary" disabled={JSON.stringify(aiDraft) === JSON.stringify(ai)} onClick={() => saveAi(aiDraft)}>
            Save AI settings
          </Button>
        </div>
      </section>

      <section className="card settings-section rise rise-2" aria-labelledby="set-data">
        <h2 className="settings-section__title" id="set-data">
          <Database size={17} /> Data
        </h2>
        <dl className="kv">
          <dt>Storage</dt>
          <dd>{engine}</dd>
          <dt>Location</dt>
          <dd className="kv__mono">{location}</dd>
        </dl>
        <div className="settings-section__foot" style={{ justifyContent: "flex-start" }}>
          {hasSample ? (
            <Button variant="glass" onClick={removeSampleData}>
              Remove sample data
            </Button>
          ) : (
            <Button variant="glass" onClick={loadSampleData}>
              Load sample data
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="danger-ghost" onClick={() => setConfirmReset(true)}>
            Delete all data…
          </Button>
        </div>
      </section>

      <section className="card settings-section rise rise-3" aria-labelledby="set-keys">
        <h2 className="settings-section__title" id="set-keys">
          <Keyboard size={17} /> Keyboard
        </h2>
        <dl className="shortcuts">
          {[
            ["Ctrl 1 / 2 / 3", "Today / Goals / Planner"],
            ["Ctrl ,", "Settings"],
            ["Ctrl N", "New goal"],
            ["← / →", "Previous / next day (Planner)"],
            ["T", "Jump to today (Planner)"],
            ["P", "Propose a plan (Planner)"],
            ["↑ / ↓", "Move a focused block by 5 min (Shift: 15, Alt: resize)"],
            ["Space, ↑ / ↓", "Reorder a task using its handle (Goals)"],
            ["Esc", "Close dialogs and menus"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>
                {k.split(" ").map((part, i) => (part === "/" ? <span key={i} className="faint"> / </span> : <span key={i} className="kbd">{part}</span>))}
              </dt>
              <dd className="muted">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="faint" style={{ fontSize: 12.5, marginTop: 20, display: "flex", gap: 8, alignItems: "center" }}>
        <KeyRound size={13} /> Life OS is local-first: no account, no cloud sync. Data leaves this device only when you use Claude for goal drafting.
      </p>

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Delete all data?"
        message="Every goal, task, schedule, commitment, history entry and setting will be permanently deleted from this device."
        confirmLabel="Delete everything"
        onConfirm={resetAll}
      />
    </div>
  );
}
