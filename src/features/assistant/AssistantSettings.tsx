import { Bot, Download, FolderOpen, Power, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { num } from "../../domain/locale";
import { t } from "../../i18n";
import {
  deleteModel,
  downloadModel,
  importModel,
  openAssistant,
  useSelectedModel,
  setIdleUnload,
  unloadModel,
  useAssistant,
} from "../../state/assistant";
import { setAssistantEnabled, setAssistantModel, useApp } from "../../state/store";
import { SelectInput } from "../../ui/fields";
import { Button, Confirm, Field, Switch } from "../../ui/primitives";

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/** Settings → AI assistant: an optional module, off until the user turns it on. */
export function AssistantSettings() {
  const enabled = useApp((s) => s.flags["ai.enabled"] === "1");
  const status = useAssistant((s) => s.status);
  const models = useAssistant((s) => s.models);
  const download = useAssistant((s) => s.download);
  const modelBusy = useAssistant((s) => s.modelBusy);
  const chosen = useSelectedModel();
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  // Turning it on where it can't run would only add a menu item that says so.
  const unavailable = !!status && !status.available;

  useEffect(() => {
    if (enabled) void openAssistant();
  }, [enabled]);

  return (
    <section className="card settings-section rise rise-1" aria-labelledby="set-assistant">
      <h2 className="settings-section__title" id="set-assistant">
        <Bot size={17} /> {t.aiModuleTitle}
      </h2>
      <div className="settings-row">
        <p className="field__hint">{t.aiModuleHint}</p>
        <Switch checked={enabled && !unavailable} disabled={unavailable && !enabled} onChange={(v) => void setAssistantEnabled(v)} label={t.aiModuleTitle} />
      </div>

      {unavailable && <p className="muted">{t.aiModuleUnavailable}</p>}

      {enabled && status?.available && (
        <>
          <div className="ai-models" role="radiogroup" aria-label={t.aiModelLabel}>
            {models.map((m) => {
              const on = m.id === chosen;
              const pct = download?.modelId === m.id && download.total ? Math.round((download.received / download.total) * 100) : null;
              const hint = m.id === "qwen3.5-2b-q4_k_m" ? t.aiModelHintFast : m.id === "qwen3.5-4b-q4_k_m" ? t.aiModelHintSmart : null;
              return (
                <div key={m.id} className={`ai-model ${on ? "ai-model--on" : ""}`}>
                  <button type="button" role="radio" aria-checked={on} className="ai-model__pick" onClick={() => void setAssistantModel(m.id)}>
                    <strong>{m.name}</strong>
                    <span className="faint tabular">{t.aiModelSize(num(gb(m.sizeBytes)), num(Math.round(m.minRamMb / 1024)))}</span>
                    {hint && <span className="faint">{hint}</span>}
                    <span className="faint">{t.aiLicence(m.licence)}</span>
                  </button>
                  <div className="ai-model__actions">
                    {m.installed ? (
                      <>
                        <span className="chip">{t.aiInstalled}</span>
                        <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} disabled={modelBusy} onClick={() => setRemoving({ id: m.id, name: m.name })}>
                          {t.aiDeleteModel}
                        </Button>
                      </>
                    ) : m.catalog ? (
                      <Button variant="glass" size="sm" icon={<Download size={14} />} disabled={modelBusy || !!download} onClick={() => void downloadModel(m.id)}>
                        {pct != null ? t.aiDownloading(num(pct)) : t.aiDownload}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="ai-settings-row">
            <Button variant="glass" icon={<FolderOpen size={15} />} disabled={modelBusy} onClick={() => void importModel()}>
              {t.aiImport}
            </Button>
            <Button variant="ghost" icon={<Power size={15} />} disabled={modelBusy || !status.loaded} onClick={() => void unloadModel()}>
              {t.aiUnload}
            </Button>
          </div>
          <div className="ai-settings-idle">
            <Field label={t.aiIdleLabel}>
              <SelectInput value={status.idleUnloadMin} onChange={(e) => void setIdleUnload(Number(e.target.value))}>
                {[5, 10, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {t.aiIdleMinutes(num(n))}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <dl className="kv">
            <dt>{t.aiRuntimeLabel}</dt>
            <dd dir="ltr">{status.runtime ? `llama.cpp ${status.runtime.llamaCpp}` : "—"}</dd>
            <dt>{t.aiLoadedLabel}</dt>
            <dd dir="ltr">{status.loaded ? `${status.loaded.name} · ${status.loaded.quant}` : t.aiNothingLoaded}</dd>
            <dt>{t.aiMemoryLabel}</dt>
            <dd className="tabular">{t.aiRam(num((status.ramAvailableMb / 1024).toFixed(1)), num((status.ramTotalMb / 1024).toFixed(1)))}</dd>
          </dl>
          <p className="faint" style={{ fontSize: 12.5 }}>
            {t.aiLocalNote}
          </p>
        </>
      )}
      <Confirm
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t.aiRemoveQ}
        message={removing ? t.aiRemoveMsg(removing.name) : ""}
        confirmLabel={t.aiDeleteModel}
        onConfirm={() => removing && void deleteModel(removing.id)}
      />
    </section>
  );
}
