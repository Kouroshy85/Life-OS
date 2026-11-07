import { ArrowUp, Bot, ChevronDown, Cpu, LayoutGrid, RotateCcw, Sparkles, Square, Target } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { decodeNote, messageText } from "../../ai/assistant/messages";
import { QUICK_PROMPTS } from "../../ai/assistant/quickPrompts";
import { t } from "../../i18n";
import type { ChatMessage } from "../../persistence/repository";
import { clearConversation, openAssistant, sendMessage, stopGenerating, useAssistant, useSelectedModel } from "../../state/assistant";
import { navigate, selectGoal, setAssistantEnabled, useApp } from "../../state/store";
import { TextArea } from "../../ui/fields";
import { Button, Confirm, Empty, IconButton } from "../../ui/primitives";
import { useIsPhone } from "../../ui/useIsPhone";
import { ProposalCard } from "./ProposalCard";

/** Where the local model stands, in a word or two. */
export function ModelStatus() {
  const status = useAssistant((s) => s.status);
  const models = useAssistant((s) => s.models);
  const busy = useAssistant((s) => s.busy);
  const modelBusy = useAssistant((s) => s.modelBusy);
  const modelId = useSelectedModel();
  const installed = models.some((m) => m.id === modelId && m.installed);
  const [label, tone] = !status
    ? [t.aiStatusChecking, "idle"]
    : !status.available
      ? [t.aiStatusUnavailable, "off"]
      : !installed
        ? [t.aiStatusNotInstalled, "off"]
        : modelBusy || status.state === "loading"
          ? [t.aiStatusLoading, "busy"]
          : busy || status.state === "generating"
            ? [t.aiStatusGenerating, "busy"]
            : status.loaded
              ? [t.aiStatusReady, "on"]
              : [t.aiStatusIdle, "idle"];
  return (
    <span className={`ai-status ai-status--${tone}`} role="status">
      <span className="ai-status__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

const MAX_INPUT_PX = 160;

function Composer({ fresh }: { fresh: boolean }) {
  const busy = useAssistant((s) => s.busy);
  const phone = useIsPhone();
  const [text, setText] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // The box grows with what's typed, up to a limit, then scrolls.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [text]);

  // Escape stops a reply from anywhere on the page.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".overlay")) stopGenerating();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  const send = () => {
    if (!text.trim() || busy) return;
    const value = text;
    setText("");
    setQuickOpen(false);
    void sendMessage(value);
  };
  const showQuick = fresh || quickOpen;

  return (
    <div className="ai-composer">
      {showQuick ? (
        <div className="ai-quick" role="group" aria-label={t.aiQuickLabel}>
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q.id}
              type="button"
              className="chip ai-quick__chip"
              disabled={busy}
              onClick={() => {
                setQuickOpen(false);
                void sendMessage(q.message(), q.kind);
              }}
            >
              {q.label()}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="chip ai-quick__toggle" aria-expanded={false} onClick={() => setQuickOpen(true)} disabled={busy}>
          <Sparkles size={13} /> {t.aiQuickLabel} <ChevronDown size={13} />
        </button>
      )}
      <div className="ai-composer__row">
        <TextArea
          ref={input}
          className="ai-composer__input"
          rows={1}
          value={text}
          maxLength={2000}
          placeholder={t.aiPlaceholder}
          aria-label={t.aiPlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // On a phone, Enter starts a new line and the button sends, like other chat apps.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !phone) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <IconButton className="ai-composer__send ai-composer__send--stop" label={`${t.aiStop} (Esc)`} onClick={stopGenerating}>
            <Square size={15} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton className="ai-composer__send" label={t.aiSend} disabled={!text.trim()} onClick={send}>
            <ArrowUp size={18} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function Note({ m }: { m: ChatMessage }) {
  const note = decodeNote(m.content);
  const saved = note?.k === "saved" ? note : null;
  return (
    <div className="ai-note-wrap">
      <p className="ai-note">{messageText(m, t)}</p>
      {saved && (saved.goalIds.length > 0 || saved.sessions > 0 || saved.rescheduled > 0 || saved.tasks > 0) && (
        <div className="ai-note__links">
          {saved.goalIds.length > 0 ? (
            <Button variant="ghost" size="sm" icon={<Target size={13} />} onClick={() => selectGoal(saved.goalIds[0])}>
              {t.aiViewGoal}
            </Button>
          ) : saved.tasks > 0 || saved.milestones > 0 || saved.updated > 0 ? (
            <Button variant="ghost" size="sm" icon={<Target size={13} />} onClick={() => navigate("goals")}>
              {t.aiViewGoals}
            </Button>
          ) : null}
          {(saved.sessions > 0 || saved.rescheduled > 0) && (
            <Button variant="ghost" size="sm" icon={<LayoutGrid size={13} />} onClick={() => navigate("week")}>
              {t.aiViewWeek}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Messages() {
  const messages = useAssistant((s) => s.messages);
  const streaming = useAssistant((s) => s.streaming);
  const modelBusy = useAssistant((s) => s.modelBusy);
  const choices = useAssistant((s) => s.choices);
  const busy = useAssistant((s) => s.busy);
  const list = useRef<HTMLDivElement>(null);

  // Only the message list scrolls; keep it at the newest message.
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, choices]);

  if (!messages.length && streaming == null) {
    return <Empty icon={<Bot size={22} />} title={t.aiEmptyTitle} text={t.aiEmptyText} />;
  }
  const lastDone = [...messages].reverse().find((m) => m.role !== "user");
  return (
    <div className="ai-messages" ref={list}>
      {messages.map((m) =>
        m.role === "note" ? (
          <Note key={m.id} m={m} />
        ) : (
          <div key={m.id} className={`ai-msg ai-msg--${m.role}`}>
            <div className="ai-bubble" dir="auto">
              {messageText(m, t)}
            </div>
            {m.proposalStatus === "interrupted" && <span className="chip ai-msg__tag">{t.aiInterrupted}</span>}
            {m.role === "assistant" && m.proposal != null && <ProposalCard msg={m} />}
            {choices?.messageId === m.id && streaming == null && (
              <div className="ai-quick ai-choices" role="group" aria-label={t.aiChoicesLabel}>
                {choices.items.map((c) => (
                  <button key={c} type="button" className="chip ai-quick__chip" dir="auto" disabled={busy} onClick={() => void sendMessage(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {streaming != null && (
        <div className="ai-msg ai-msg--assistant" aria-busy="true">
          <div className="ai-bubble ai-bubble--streaming" dir="auto">
            {streaming ||
              (modelBusy ? (
                <span className="faint">{t.aiStatusLoading}</span>
              ) : (
                <span className="ai-typing" aria-label={t.aiThinking}>
                  <i />
                  <i />
                  <i />
                </span>
              ))}
          </div>
        </div>
      )}
      {/* Screen readers hear each finished reply once, not every word as it streams. */}
      <p className="sr-only" aria-live="polite">
        {streaming == null && lastDone ? messageText(lastDone, t) : ""}
      </p>
    </div>
  );
}

export function AssistantView() {
  const enabled = useApp((s) => s.flags["ai.enabled"] === "1");
  const status = useAssistant((s) => s.status);
  const models = useAssistant((s) => s.models);
  const messages = useAssistant((s) => s.messages);
  const streaming = useAssistant((s) => s.streaming);
  const modelId = useSelectedModel();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void openAssistant();
  }, []);

  const installed = models.some((m) => m.id === modelId && m.installed);
  const chatting = enabled && status?.available && installed;

  let body;
  if (!enabled) {
    body = <Empty icon={<Bot size={22} />} title={t.aiOffTitle} text={t.aiOffText} action={<Button variant="primary" onClick={() => setAssistantEnabled(true)}>{t.aiTurnOn}</Button>} />;
  } else if (status && !status.available) {
    body = <Empty icon={<Cpu size={22} />} title={t.aiUnavailableTitle} text={t.aiUnavailableText} />;
  } else if (status && !installed) {
    body = <Empty icon={<Cpu size={22} />} title={t.aiSetupTitle} text={t.aiSetupText} action={<Button variant="primary" onClick={() => navigate("settings")}>{t.aiOpenSettings}</Button>} />;
  } else {
    body = (
      <>
        <Messages />
        <Composer fresh={!messages.length && streaming == null} />
      </>
    );
  }

  return (
    <div className={`page page--assistant ${chatting ? "page--chat" : ""}`}>
      <div className="page-head ai-head">
        <div>
          <div className="eyebrow">{t.aiEyebrow}</div>
          <h1 className="page-title" tabIndex={-1} data-page-heading>
            {t.navAssistant}
          </h1>
          {!messages.length && <p className="page-sub">{t.aiSub}</p>}
        </div>
        <div className="ai-head-actions">
          {enabled && <ModelStatus />}
          {enabled && messages.length > 0 && (
            <Button variant="glass" size="sm" icon={<RotateCcw size={14} />} onClick={() => setConfirmClear(true)}>
              {t.aiClear}
            </Button>
          )}
        </div>
      </div>
      <div className="card ai-chat rise">{body}</div>
      <Confirm open={confirmClear} onClose={() => setConfirmClear(false)} title={t.aiClearQ} message={t.aiClearMsg} confirmLabel={t.aiClear} onConfirm={() => void clearConversation()} />
    </div>
  );
}
