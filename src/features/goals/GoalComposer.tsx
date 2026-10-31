import { Cpu, Sparkles } from "lucide-react";
import type { CompileOutcome } from "../../ai/planProvider";
import { num } from "../../domain/locale";
import { formatDuration, formatShortDate } from "../../domain/time";
import { t } from "../../i18n";
import { PriorityDot } from "../../ui/taskBits";

export function SourceBadge({ source, model }: { source: "template" | "ai" | "manual"; model: string | null }) {
  if (source === "ai") {
    return (
      <span className="badge-source badge-source--ai" title={t.sourceAiTitle}>
        <Sparkles size={12} /> Claude · {model}
      </span>
    );
  }
  if (source === "template") {
    return (
      <span className="badge-source" title={t.sourceBuiltInTitle}>
        <Cpu size={12} /> {t.sourceBuiltIn}
      </span>
    );
  }
  return <span className="badge-source">{t.sourceManual}</span>;
}

export function PlanPreview({ outcome }: { outcome: CompileOutcome }) {
  const { plan } = outcome;
  const total = plan.milestones.reduce((s, m) => s + m.projects.reduce((s2, p) => s2 + p.tasks.reduce((s3, t) => s3 + t.estimateMin, 0), 0), 0);
  const count = plan.milestones.reduce((s, m) => s + m.projects.reduce((s2, p) => s2 + p.tasks.length, 0), 0);
  return (
    <div className="plan-preview">
      <div className="plan-preview__head">
        <SourceBadge source={plan.source} model={plan.model} />
        <span className="faint" style={{ fontSize: 13 }}>
          {t.previewCounts(plan.milestones.length, count, formatDuration(total))}
        </span>
      </div>
      {outcome.fallbackReason && <p className="notice notice--warn">{outcome.fallbackReason}</p>}
      {plan.notes.length > 0 && (
        <ul className="plan-preview__notes">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <ol className="plan-preview__list">
        {plan.milestones.map((m, i) => (
          <li key={i} className="plan-preview__milestone">
            <div className="plan-preview__mhead">
              <span className="plan-preview__num">{num(i + 1)}</span>
              <strong>{m.title}</strong>
              {m.deadline && <span className="chip">{t.byDate(formatShortDate(m.deadline))}</span>}
            </div>
            {m.projects.map((p, pi) => (
              <div key={pi} className="plan-preview__project">
                <div className="eyebrow" style={{ marginBottom: 6 }}>{p.title}</div>
                <ul>
                  {p.tasks.map((t, ti) => (
                    <li key={ti}>
                      <PriorityDot priority={t.priority} />
                      <span style={{ flex: 1 }}>{t.title}</span>
                      <span className="faint tabular" style={{ fontSize: 12 }}>
                        {formatDuration(t.estimateMin)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
