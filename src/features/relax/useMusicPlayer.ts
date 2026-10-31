import { useCallback, useEffect, useRef, useState } from "react";
import type { Song } from "../../domain/types";
import { t } from "../../i18n";
import { audioStore } from "../../persistence/audioStore";
import { toast } from "../../state/store";

const VOLUME_KEY = "life-os.volume";

function savedVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return v > 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
}

export type RepeatMode = "off" | "all" | "one";

/** The player behind the Relax screen: one audio element, a queue, and its controls. */
export function useMusicPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(savedVolume);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");

  // Event handlers run long after render, so they read the latest values from here.
  const latest = useRef({ queue, index, shuffle, repeat });
  latest.current = { queue, index, shuffle, repeat };

  const load = useCallback(async (list: Song[], i: number) => {
    const el = audio.current;
    const song = list[i];
    if (!el || !song) return;
    setQueue(list);
    setIndex(i);
    setTime(0);
    setDuration(song.durationSec);
    try {
      el.src = await audioStore().url(song.id, song.ext);
      await el.play();
    } catch (e) {
      // Ignored when a newer song interrupted this one; anything else is a real failure.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast(t.playFailed(song.title), "error");
        setPlaying(false);
      }
    }
  }, []);

  const advance = useCallback(
    (dir: 1 | -1, fromEnded = false) => {
      const { queue: q, index: i, shuffle: sh, repeat: rep } = latest.current;
      if (!q.length) return;
      if (sh && q.length > 1) {
        let n = i;
        while (n === i) n = Math.floor(Math.random() * q.length);
        void load(q, n);
        return;
      }
      const n = i + dir;
      if (n >= 0 && n < q.length) void load(q, n);
      else if (rep === "all" || !fromEnded) void load(q, (n + q.length) % q.length);
      else {
        setPlaying(false);
        setTime(0);
      }
    },
    [load],
  );

  useEffect(() => {
    const el = new Audio();
    el.preload = "metadata";
    el.volume = savedVolume();
    audio.current = el;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (latest.current.repeat === "one") {
        el.currentTime = 0;
        void el.play();
      } else advance(1, true);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      audio.current = null;
    };
  }, [advance]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el || !el.src) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seek = useCallback((to: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = to;
    setTime(to);
  }, []);

  const setVolume = useCallback((v: number) => {
    if (audio.current) audio.current.volume = v;
    setVolumeState(v);
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      // A remembered volume is only a convenience.
    }
  }, []);

  const previous = useCallback(() => {
    if ((audio.current?.currentTime ?? 0) > 3) seek(0);
    else advance(-1);
  }, [advance, seek]);

  /** Stops playback if the given song (or any in a removed playlist) is the one playing. */
  const forget = useCallback((ids: string[]) => {
    const { queue: q, index: i } = latest.current;
    const current = q[i];
    const rest = q.filter((s) => !ids.includes(s.id));
    if (current && ids.includes(current.id)) {
      const el = audio.current;
      el?.pause();
      el?.removeAttribute("src");
      setIndex(-1);
      setPlaying(false);
      setTime(0);
      setDuration(0);
    } else if (current) {
      setIndex(rest.indexOf(current));
    }
    setQueue(rest);
  }, []);

  return {
    queue,
    current: queue[index] ?? null,
    playing,
    time,
    duration,
    volume,
    shuffle,
    repeat,
    play: load,
    toggle,
    next: () => advance(1),
    previous,
    seek,
    setVolume,
    toggleShuffle: () => setShuffle((v) => !v),
    cycleRepeat: () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")),
    forget,
  };
}

export type MusicPlayer = ReturnType<typeof useMusicPlayer>;
