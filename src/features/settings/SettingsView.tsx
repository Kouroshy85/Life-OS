import { Database, KeyRound, Keyboard, Languages, Moon, Quote, RotateCcw, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { aiConfigured, aiStatusLabel, testConnection } from "../../ai/planProvider";
import { textProblem } from "../../domain/text";
import { t } from "../../i18n";
import { textErrorMessage } from "../planner/PlanWizard";
import { addQuote, deleteQuote, hiddenQuotes, setHiddenQuotes, loadSampleData, removeSampleData, resetAll, saveAi, savePrefs, setLanguage, useApp, validatePrefs } from "../../state/store";
import { SelectInput, TextInput, TimeInput } from "../../ui/fields";
import { Button, Confirm, Field, IconButton, Segmented, Switch } from "../../ui/primitives";
import { PrefsFields } from "../planner/PrefsForm";
import { ThemeSection } from "../shell/ThemeSwitcher";

export function SettingsView() {
  const prefs = useApp((s) => s.prefs);
  const ai = useApp((s) => s.ai);
  const engine = useApp((s) => s.engine);
  const location = useApp((s) => s.location);
  const lang = useApp((s) => s.lang);
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
          <div className="eyebrow">{t.preferences}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {t.settingsTitle}
          </h1>
        </div>
      </div>

      <section className="card settings-section rise" aria-labelledby="set-lang">
        <h2 className="settings-section__title" id="set-lang">
          <Languages size={17} /> {t.languageTitle}
        </h2>
        <div>
          <Segmented
            label={t.languageTitle}
            value={lang}
            onChange={setLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "fa", label: "فارسی" },
            ]}
          />
        </div>
        <p className="field__hint">{t.languageHint}</p>
      </section>

      <ThemeSection />

      <section className="card settings-section rise" aria-labelledby="set-plan">
        <h2 className="settings-section__title" id="set-plan">
          <SlidersHorizontal size={17} /> {t.planningSection}
        </h2>
        <PrefsFields value={draft} onChange={setDraft} />
        <div className="settings-section__foot">
          {prefsError && <span className="field__error">{prefsError}</span>}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" disabled={!prefsDirty} onClick={() => setDraft(prefs)}>
            {t.discard}
          </Button>
          <Button variant="primary" disabled={!prefsDirty || !!prefsError} onClick={() => savePrefs(draft)}>
            {t.savePlanning}
          </Button>
        </div>
      </section>

      <SleepSection />

      <section className="card settings-section rise rise-1" aria-labelledby="set-ai">
        <h2 className="settings-section__title" id="set-ai">
          <Sparkles size={17} /> {t.aiSection} <span className={`badge-source ${aiConfigured(ai) ? "badge-source--ai" : ""}`} style={{ marginInlineStart: 8 }}>{aiStatusLabel(ai)}</span>
        </h2>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: 680 }}>
          {t.aiIntro}
        </p>
        <div className="field-row" style={{ gridTemplateColumns: "200px 1fr 1fr" }}>
          <Field label={t.provider}>
            <SelectInput value={aiDraft.provider} onChange={(e) => setAiDraft({ ...aiDraft, provider: e.target.value as typeof aiDraft.provider })}>
              <option value="none">{t.providerNone}</option>
              <option value="anthropic">Anthropic Claude</option>
            </SelectInput>
          </Field>
          <Field label={t.apiKey} hint={t.apiKeyHint}>
            <TextInput
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              disabled={aiDraft.provider === "none"}
              value={aiDraft.apiKey}
              onChange={(e) => setAiDraft({ ...aiDraft, apiKey: e.target.value })}
            />
          </Field>
          <Field label={t.model}>
            <TextInput dir="ltr" disabled={aiDraft.provider === "none"} value={aiDraft.model} spellCheck={false} onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })} />
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
            {testing ? t.testing : t.testConnection}
          </Button>
          <Button variant="primary" disabled={JSON.stringify(aiDraft) === JSON.stringify(ai)} onClick={() => saveAi(aiDraft)}>
            {t.saveAi}
          </Button>
        </div>
      </section>

      <QuotesSection />

      <section className="card settings-section rise rise-2" aria-labelledby="set-data">
        <h2 className="settings-section__title" id="set-data">
          <Database size={17} /> {t.dataSection}
        </h2>
        <dl className="kv">
          <dt>{t.storage}</dt>
          <dd>{engine}</dd>
          <dt>{t.location}</dt>
          <dd className="kv__mono" dir="ltr">{location}</dd>
        </dl>
        <div className="settings-section__foot" style={{ justifyContent: "flex-start" }}>
          {hasSample ? (
            <Button variant="glass" onClick={removeSampleData}>
              {t.removeSample}
            </Button>
          ) : (
            <Button variant="glass" onClick={loadSampleData}>
              {t.loadSample}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="danger-ghost" onClick={() => setConfirmReset(true)}>
            {t.deleteAll}
          </Button>
        </div>
      </section>

      <section className="card settings-section rise rise-3" aria-labelledby="set-keys">
        <h2 className="settings-section__title" id="set-keys">
          <Keyboard size={17} /> {t.keyboardSection}
        </h2>
        <dl className="shortcuts">
          {t.shortcuts.map(([k, v]) => (
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
        <KeyRound size={13} /> {t.localFirst}
      </p>

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t.deleteAllQ}
        message={t.deleteAllMsg}
        confirmLabel={t.deleteEverything}
        onConfirm={resetAll}
      />
    </div>
  );
}

function SleepSection() {
  const prefs = useApp((s) => s.prefs);
  const [draft, setDraft] = useState(prefs);
  useEffect(() => setDraft(prefs), [prefs]);
  const error = validatePrefs(draft);
  const dirty = draft.sleepStart !== prefs.sleepStart || draft.wakeTime !== prefs.wakeTime || draft.planGap !== prefs.planGap;
  return (
    <section className="card settings-section rise rise-1" aria-labelledby="set-sleep">
      <h2 className="settings-section__title" id="set-sleep">
        <Moon size={17} /> {t.sleepSection}
      </h2>
      <p className="muted" style={{ fontSize: 13.5, maxWidth: 680 }}>
        {t.sleepIntro}
      </p>
      <div className="field-row" style={{ gridTemplateColumns: "repeat(2, minmax(0, 220px))" }}>
        <Field label={t.sleepTime} hint={t.optional}>
          <TimeInput value={draft.sleepStart} allowEmpty onChange={(v) => setDraft({ ...draft, sleepStart: v })} />
        </Field>
        <Field label={t.wakeTime} hint={t.optional}>
          <TimeInput value={draft.wakeTime} allowEmpty onChange={(v) => setDraft({ ...draft, wakeTime: v })} />
        </Field>
      </div>
      <label className="check" style={{ justifyContent: "space-between", maxWidth: 680 }}>
        <span>
          <span style={{ color: "var(--text)", fontWeight: 560 }}>{t.gapLabel}</span>
          <br />
          <span className="faint" style={{ fontSize: 12 }}>
            {t.gapHint}
          </span>
        </span>
        <Switch checked={draft.planGap} onChange={(v) => setDraft({ ...draft, planGap: v })} label={t.gapLabel} />
      </label>
      <div className="settings-section__foot">
        {error && <span className="field__error">{error}</span>}
        <span style={{ flex: 1 }} />
        <Button variant="primary" disabled={!dirty || !!error} onClick={() => savePrefs(draft)}>
          {t.saveSleep}
        </Button>
      </div>
    </section>
  );
}

function QuotesSection() {
  const userQuotes = useApp((s) => s.userQuotes);
  const flags = useApp((s) => s.flags);
  const hidden = hiddenQuotes(flags);
  const defaults = t.relaxQuotes.filter((q) => !hidden.includes(q));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const problem = textErrorMessage(textProblem(text, { min: 4 }));
    if (problem) return setError(problem);
    const value = text.trim();
    if ([...t.relaxQuotes, ...userQuotes.map((q) => q.text)].includes(value)) return setError(t.quoteDuplicate);
    await addQuote(value);
    setText("");
    setError(null);
  };

  return (
    <section className="card settings-section rise rise-2" aria-labelledby="set-quotes">
      <h2 className="settings-section__title" id="set-quotes">
        <Quote size={17} /> {t.quotesSection}
      </h2>
      <p className="muted" style={{ fontSize: 13.5, maxWidth: 680 }}>
        {t.quotesIntro}
      </p>
      <form
        className="quote-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label={t.quoteNew} error={error}>
          <TextInput value={text} maxLength={200} placeholder={t.quotePh} onChange={(e) => { setText(e.target.value); setError(null); }} />
        </Field>
        <Button variant="primary" type="submit" style={{ marginTop: 26 }}>
          {t.add}
        </Button>
      </form>
      <ul className="quote-list">
        {userQuotes.map((q) => (
          <li key={q.id} className="quote-row">
            <p>{q.text}</p>
            <span className="chip chip--accent">{t.quoteYours}</span>
            <IconButton label={t.delete} onClick={() => deleteQuote(q.id)}>
              <Trash2 size={15} />
            </IconButton>
          </li>
        ))}
        {defaults.map((q) => (
          <li key={q} className="quote-row">
            <p>{q}</p>
            <IconButton label={t.delete} onClick={() => setHiddenQuotes([...hidden, q])}>
              <Trash2 size={15} />
            </IconButton>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setHiddenQuotes([])}>
            {t.quotesRestore}
          </Button>
        </div>
      )}
    </section>
  );
}
