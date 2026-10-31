import { Pause, Play, Plus, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTrackTime, pickDifferent } from "../../domain/audioFormat";
import { num } from "../../domain/locale";
import { textProblem } from "../../domain/text";
import { formatDuration } from "../../domain/time";
import { t } from "../../i18n";
import { isTauri } from "../../persistence/driver";
import { newId, nowIso } from "../../persistence/repository";
import { hiddenQuotes, leaveRelax, savePlaylist, startRelax, useApp } from "../../state/store";
import { TextInput } from "../../ui/fields";
import { Button, Field, IconButton } from "../../ui/primitives";
import { Wizard, WizardError, WizardQuestion } from "../../ui/Wizard";
import { textErrorMessage } from "../planner/PlanWizard";
import { ThemeScene } from "../shell/ThemeScene";
import { PlaylistIcon } from "./PlaylistIcon";
import { PlaylistPanel } from "./PlaylistPanel";
import { useMusicPlayer } from "./useMusicPlayer";

const MAX_MINUTES = 8 * 60;
const QUOTE_EVERY_MS = 2 * 60 * 1000;

/** "How much time do you need?" then a name for it, then into Relax. */
export function RelaxLauncher() {
  const open = useApp((s) => s.relaxPickerOpen);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [minutes, setMinutes] = useState(0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDirection(1);
    setMinutes(0);
    setTitle("");
    setError(null);
  }, [open]);

  const add = (m: number) => {
    setMinutes((cur) => Math.min(MAX_MINUTES, cur + m));
    setError(null);
  };

  const next = () => {
    if (step === 0) {
      if (minutes <= 0) return setError(t.relaxPickTime);
      setDirection(1);
      setStep(1);
      setError(null);
      return;
    }
    const problem = textErrorMessage(textProblem(title, { required: false }));
    if (problem) return setError(problem);
    startRelax(title.trim() || t.relaxDefaultTitle, minutes);
  };

  return (
    <Wizard
      open={open}
      onClose={() => useApp.setState({ relaxPickerOpen: false })}
      title={t.navRelax}
      step={step}
      total={2}
      direction={direction}
      onBack={
        step === 1
          ? () => {
              setDirection(-1);
              setStep(0);
            }
          : undefined
      }
      onNext={next}
      nextLabel={step === 1 ? t.relaxEnter : t.continue}
    >
      {step === 0 ? (
        <>
          <WizardQuestion title={t.relaxQTime} />
          <div className="relax-pick">
            <output className="relax-pick__total tabular" aria-live="polite">
              {minutes ? formatDuration(minutes) : formatDuration(0)}
            </output>
            <div className="relax-pick__add">
              {[15, 30, 60].map((m) => (
                <button key={m} type="button" className="relax-pick__btn" data-step-focus={m === 15 ? "" : undefined} onClick={() => add(m)}>
                  <Plus size={15} />
                  {formatDuration(m)}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" disabled={!minutes} onClick={() => setMinutes(0)}>
              {t.relaxReset}
            </Button>
          </div>
        </>
      ) : (
        <>
          <WizardQuestion title={t.relaxQTitle} hint={t.optional} />
          <Field label={t.taskTitle}>
            <TextInput className="wiz-input" value={title} maxLength={60} placeholder={t.relaxTitlePh} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
          </Field>
        </>
      )}
      {error && <WizardError>{error}</WizardError>}
    </Wizard>
  );
}

/** A soft two-note chime, made in place so no sound file has to ship with the app. */
function chime() {
  try {
    const ctx = new AudioContext();
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.35;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 1.9);
    });
    setTimeout(() => void ctx.close(), 3000);
  } catch {
    // The chime is a nicety; the screen already shows the time is up.
  }
}

function useCountdown(minutes: number) {
  const [total, setTotal] = useState(minutes * 60);
  const [deadline, setDeadline] = useState(() => Date.now() + minutes * 60_000);
  const [pausedLeft, setPausedLeft] = useState<number | null>(null);
  const [left, setLeft] = useState(minutes * 60);
  const rang = useRef(false);

  useEffect(() => {
    const update = () => {
      const value = pausedLeft ?? Math.max(0, (deadline - Date.now()) / 1000);
      setLeft(value);
      if (value <= 0 && !rang.current) {
        rang.current = true;
        chime();
      }
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [deadline, pausedLeft]);

  const toggle = useCallback(() => {
    setPausedLeft((p) => {
      if (p == null) return Math.max(0, (deadline - Date.now()) / 1000);
      setDeadline(Date.now() + p * 1000);
      return null;
    });
  }, [deadline]);

  const addTime = useCallback(
    (m: number) => {
      rang.current = false;
      setTotal((v) => (left <= 0 ? m * 60 : v + m * 60));
      setPausedLeft((p) => (p == null ? null : p + m * 60));
      setDeadline((d) => Math.max(d, Date.now()) + m * 60_000);
    },
    [left],
  );

  return { left, total, paused: pausedLeft != null, finished: left <= 0, toggle, addTime };
}

function TimerRing({ title, minutes }: { title: string; minutes: number }) {
  const { left, total, paused, finished, toggle, addTime } = useCountdown(minutes);
  const size = 340;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = total ? Math.max(0, Math.min(1, left / total)) : 0;
  const shown = Math.ceil(left);
  return (
    <section className="relax-timer" aria-label={t.relaxTimer}>
      <div className={`relax-ring ${finished ? "relax-ring--done" : ""}`}>
        <svg width="100%" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <defs>
            <linearGradient id="relax-ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--violet-300)" }} />
              <stop offset="1" style={{ stopColor: "var(--violet-500)" }} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--line)" }} strokeWidth={stroke} />
          <circle
            className="relax-ring__value"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#relax-ring-grad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fraction)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="relax-ring__center">
          <span className="relax-ring__time tabular" role="timer">
            {finished ? t.relaxTimeUp : num(formatTrackTime(shown))}
          </span>
          <span className="relax-ring__title">{title}</span>
        </div>
      </div>
      <div className="relax-timer__actions">
        {finished ? (
          <>
            <Button variant="glass" size="sm" onClick={() => addTime(15)}>+{formatDuration(15)}</Button>
            <Button variant="glass" size="sm" onClick={() => addTime(30)}>+{formatDuration(30)}</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={paused ? <Play size={13} /> : <Pause size={13} />} onClick={toggle}>
            {paused ? t.relaxResume : t.relaxPause}
          </Button>
        )}
      </div>
    </section>
  );
}

function CD({ spinning }: { spinning: boolean }) {
  return (
    <div className={`cd ${spinning ? "cd--on" : ""}`} aria-hidden="true">
      <div className="cd__disc">
        <span className="cd__label" />
        <span className="cd__hole" />
      </div>
    </div>
  );
}

function useQuote() {
  const userQuotes = useApp((s) => s.userQuotes);
  const flags = useApp((s) => s.flags);
  const pool = useMemo(() => {
    const hidden = hiddenQuotes(flags);
    return [...t.relaxQuotes.filter((q) => !hidden.includes(q)), ...userQuotes.map((q) => q.text)];
  }, [userQuotes, flags]);
  const [quote, setQuote] = useState<string | null>(() => pickDifferent(pool, null));
  useEffect(() => {
    const id = setInterval(() => setQuote((cur) => pickDifferent(pool, cur)), QUOTE_EVERY_MS);
    return () => clearInterval(id);
  }, [pool]);
  return quote;
}

/** The whole-screen relax space: music on the left, the timer on the right, a quote below. */
export function RelaxMode() {
  const session = useApp((s) => s.relaxSession);
  const closing = useApp((s) => s.relaxClosing);
  const playlists = useApp((s) => s.playlists);
  const songs = useApp((s) => s.songs);
  const player = useMusicPlayer();
  const quote = useQuote();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const openPlaylist = playlists.find((p) => p.id === openId) ?? null;

  useEffect(() => {
    if (isTauri()) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(true)).catch(() => undefined);
    }
    return () => {
      if (isTauri()) {
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(false)).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".overlay")) return;
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName) && (e.target as HTMLInputElement).type !== "range";
      if (e.key === "Escape" && !typing) leaveRelax();
      if (e.code === "Space" && !typing && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  if (!session) return null;

  const createPlaylist = async () => {
    const problem = textErrorMessage(textProblem(newName));
    if (problem) return setNameError(problem);
    const playlist = { id: newId(), name: newName.trim(), icon: "music", createdAt: nowIso() };
    await savePlaylist(playlist);
    setAdding(false);
    setNewName("");
    setNameError(null);
    setOpenId(playlist.id);
  };

  const { current, playing, time, duration, volume, shuffle, repeat } = player;
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className={`relax ${closing ? "relax--closing" : ""}`} role="dialog" aria-modal="true" aria-label={t.navRelax}>
      <div className="relax__sky" aria-hidden="true" />
      <ThemeScene />
      <IconButton className="relax__exit" label={t.relaxExit} onClick={leaveRelax}>
        <X size={20} />
      </IconButton>

      <div className="relax__stage">
        <section className="relax__music" aria-label={t.relaxMusic}>
          {openPlaylist ? (
            <PlaylistPanel key={openPlaylist.id} playlist={openPlaylist} player={player} onBack={() => setOpenId(null)} />
          ) : (
            <div className="relax__now">
              <CD spinning={playing} />
              <div className="now-track">
                <strong className="now-track__title">{current?.title ?? t.relaxNothing}</strong>
                <span className="now-track__artist">{current ? current.artist || t.relaxUnknownArtist : t.relaxNothingHint}</span>
              </div>

              <div className="scrub">
                <input
                  type="range"
                  className="range"
                  aria-label={t.relaxSeek}
                  min={0}
                  max={duration || 1}
                  step={0.5}
                  value={Math.min(time, duration || 1)}
                  disabled={!current}
                  style={{ ["--fill" as string]: `${duration ? (time / duration) * 100 : 0}%` }}
                  onChange={(e) => player.seek(Number(e.target.value))}
                />
                <div className="scrub__times tabular">
                  <span>{num(formatTrackTime(time))}</span>
                  <span>-{num(formatTrackTime(Math.max(0, duration - time)))}</span>
                </div>
              </div>

              <div className="transport">
                <button type="button" className={`transport__small ${shuffle ? "is-on" : ""}`} aria-label={t.relaxShuffle} aria-pressed={shuffle} onClick={player.toggleShuffle}>
                  <Shuffle size={16} />
                </button>
                <button type="button" className="transport__skip" aria-label={t.relaxPrev} disabled={!current} onClick={player.previous}>
                  <SkipBack size={24} fill="currentColor" />
                </button>
                <button type="button" className="transport__play" aria-label={playing ? t.relaxPauseMusic : t.relaxPlayMusic} disabled={!current} onClick={player.toggle}>
                  {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                </button>
                <button type="button" className="transport__skip" aria-label={t.relaxNext} disabled={!current} onClick={player.next}>
                  <SkipForward size={24} fill="currentColor" />
                </button>
                <button type="button" className={`transport__small ${repeat !== "off" ? "is-on" : ""}`} aria-label={t.relaxRepeat} aria-pressed={repeat !== "off"} onClick={player.cycleRepeat}>
                  <RepeatIcon size={16} />
                </button>
              </div>

              <div className="volume">
                <VolumeIcon size={15} />
                <input
                  type="range"
                  className="range"
                  aria-label={t.relaxVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  style={{ ["--fill" as string]: `${volume * 100}%` }}
                  onChange={(e) => player.setVolume(Number(e.target.value))}
                />
              </div>

              <div className="pl-strip" aria-label={t.relaxPlaylists}>
                {playlists.map((p) => (
                  <button key={p.id} type="button" className={`pl-chip ${songs.some((s) => s.playlistId === p.id && s.id === current?.id) ? "pl-chip--on" : ""}`} onClick={() => setOpenId(p.id)}>
                    <span className="pl-chip__icon">
                      <PlaylistIcon name={p.icon} />
                    </span>
                    <span className="pl-chip__name">{p.name}</span>
                  </button>
                ))}
                {adding ? (
                  <form
                    className="pl-new"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void createPlaylist();
                    }}
                  >
                    <Field label={t.playlistName} error={nameError}>
                      <TextInput autoFocus value={newName} maxLength={60} placeholder={t.playlistNamePh} onChange={(e) => { setNewName(e.target.value); setNameError(null); }} />
                    </Field>
                    <div className="pl-new__actions">
                      <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNameError(null); }}>{t.cancel}</Button>
                      <Button size="sm" variant="primary" type="submit">{t.add}</Button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="pl-chip pl-chip--add" onClick={() => setAdding(true)}>
                    <span className="pl-chip__icon">
                      <Plus size={18} />
                    </span>
                    <span className="pl-chip__name">{t.addPlaylist}</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        <TimerRing title={session.title} minutes={session.minutes} />
      </div>

      {quote && (
        <p key={quote} className="relax__quote">
          {quote}
        </p>
      )}
    </div>
  );
}
