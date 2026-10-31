import { ArrowLeft, AudioLines, Check, CircleAlert, Play, Plus, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { AUDIO_ACCEPT, extensionOf, formatTrackTime, isAudioExtension, MAX_AUDIO_BYTES, readId3, SNIFF_BYTES, sniffAudio, titleFromFileName } from "../../domain/audioFormat";
import { num, pct } from "../../domain/locale";
import type { Playlist, Song } from "../../domain/types";
import { t } from "../../i18n";
import { audioStore, UploadCancelled } from "../../persistence/audioStore";
import { newId, nowIso } from "../../persistence/repository";
import { addSong, deletePlaylist, deleteSong, savePlaylist, useApp } from "../../state/store";
import { InlineText } from "../../ui/InlineText";
import { Button, Confirm, IconButton } from "../../ui/primitives";
import { PLAYLIST_ICONS, PlaylistIcon } from "./PlaylistIcon";
import type { MusicPlayer } from "./useMusicPlayer";

interface Upload {
  key: string;
  name: string;
  fraction: number;
  state: "uploading" | "done" | "rejected" | "cancelled";
  message?: string;
  abort: AbortController;
}

/** Reads how long a file plays. A file the player can't open is rejected here. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const finish = (value: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 10000);
    probe.preload = "metadata";
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(null);
    probe.src = url;
  });
}

export function PlaylistPanel({ playlist, player, onBack }: { playlist: Playlist; player: MusicPlayer; onBack: () => void }) {
  const allSongs = useApp((s) => s.songs);
  const songs = allSongs.filter((s) => s.playlistId === playlist.id);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const uploadOne = async (file: File, sortOrder: number) => {
    const key = newId();
    const abort = new AbortController();
    setUploads((list) => [...list, { key, name: file.name, fraction: 0, state: "uploading", abort }]);
    const reject = (message: string) => patch(key, { state: "rejected", message });

    const ext = extensionOf(file.name);
    if (!isAudioExtension(ext)) return reject(t.audioBadType);
    if (file.size === 0) return reject(t.audioEmpty);
    if (file.size > MAX_AUDIO_BYTES) return reject(t.audioTooBig);
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    if (!sniffAudio(head)) return reject(t.audioNotReal);
    const duration = await probeDuration(file);
    if (duration == null) return reject(t.audioUnreadable);

    const id = newId();
    try {
      await audioStore().save(id, ext, file, (fraction) => patch(key, { fraction }), abort.signal);
    } catch (e) {
      if (e instanceof UploadCancelled) return patch(key, { state: "cancelled" });
      return reject(t.audioFailed);
    }
    const tags = readId3(head);
    const song: Song = {
      id,
      playlistId: playlist.id,
      title: tags.title ?? titleFromFileName(file.name),
      artist: tags.artist ?? "",
      ext,
      sizeBytes: file.size,
      durationSec: duration,
      sortOrder,
      createdAt: nowIso(),
    };
    await addSong(song);
    patch(key, { state: "done", fraction: 1 });
    // Finished rows clear themselves so the list stays calm.
    setTimeout(() => setUploads((list) => list.filter((u) => u.key !== key)), 1800);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const start = songs.reduce((m, s) => Math.max(m, s.sortOrder + 1), 0);
    // One at a time: the bar then shows each song's real progress.
    let order = start;
    for (const file of Array.from(files)) await uploadOne(file, order++);
    if (input.current) input.current.value = "";
  };

  const removePlaylist = async () => {
    player.forget(songs.map((s) => s.id));
    await deletePlaylist(playlist.id);
    onBack();
  };

  return (
    <div className="pl-panel">
      <div className="pl-panel__head">
        <IconButton label={t.backToPlayer} onClick={onBack}>
          <ArrowLeft size={18} className="flip-rtl" />
        </IconButton>
        <span className="pl-panel__icon">
          <PlaylistIcon name={playlist.icon} size={22} />
        </span>
        <div className="pl-panel__name">
          <InlineText className="pl-panel__title" label={t.playlistName} value={playlist.name} onSave={(name) => savePlaylist({ ...playlist, name })} maxLength={60} />
          <span className="faint tabular">{t.songCount(num(songs.length))}</span>
        </div>
        <IconButton label={t.deletePlaylist} onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} />
        </IconButton>
      </div>

      <div className="pl-icons" role="radiogroup" aria-label={t.playlistIcon}>
        {PLAYLIST_ICONS.map((name) => (
          <button key={name} type="button" role="radio" aria-checked={playlist.icon === name} aria-label={name} className={`pl-icon ${playlist.icon === name ? "pl-icon--on" : ""}`} onClick={() => savePlaylist({ ...playlist, icon: name })}>
            <PlaylistIcon name={name} size={15} />
          </button>
        ))}
      </div>

      <div className="pl-actions">
        <Button variant="primary" icon={<Play size={14} fill="currentColor" />} disabled={!songs.length} onClick={() => player.play(songs, 0)}>
          {t.playAll}
        </Button>
        <Button variant="glass" icon={<Upload size={14} />} onClick={() => input.current?.click()}>
          {t.addMusic}
        </Button>
        <input ref={input} type="file" accept={AUDIO_ACCEPT} multiple hidden data-audio-input onChange={(e) => onFiles(e.target.files)} />
      </div>

      {uploads.length > 0 && (
        <ul className="pl-uploads" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className={`pl-upload pl-upload--${u.state}`}>
              <div className="pl-upload__row">
                {u.state === "done" ? <Check size={14} /> : u.state === "rejected" ? <CircleAlert size={14} /> : <AudioLines size={14} />}
                <span className="pl-upload__name">{u.name}</span>
                {u.state === "uploading" && <span className="tabular faint">{pct(Math.round(u.fraction * 100))}</span>}
                {u.state === "uploading" ? (
                  <IconButton label={t.cancel} style={{ width: 22, height: 22 }} onClick={() => u.abort.abort()}>
                    <X size={13} />
                  </IconButton>
                ) : u.state !== "done" ? (
                  <IconButton label={t.dismiss} style={{ width: 22, height: 22 }} onClick={() => setUploads((l) => l.filter((x) => x.key !== u.key))}>
                    <X size={13} />
                  </IconButton>
                ) : null}
              </div>
              {u.state === "uploading" && (
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.fraction * 100)}>
                  <div className="bar__fill" style={{ width: `${u.fraction * 100}%` }} />
                </div>
              )}
              {u.message && <p className="pl-upload__msg">{u.message}</p>}
              {u.state === "cancelled" && <p className="pl-upload__msg">{t.audioCancelled}</p>}
            </li>
          ))}
        </ul>
      )}

      {songs.length === 0 && uploads.length === 0 ? (
        <button type="button" className="pl-empty" onClick={() => input.current?.click()}>
          <Plus size={20} />
          <strong>{t.playlistEmpty}</strong>
          <span className="faint">{t.audioFormats}</span>
        </button>
      ) : (
        <ol className="pl-songs">
          {songs.map((song, i) => {
            const isCurrent = player.current?.id === song.id;
            return (
              <li key={song.id} className={`pl-song ${isCurrent ? "pl-song--on" : ""}`}>
                <button type="button" className="pl-song__main" onClick={() => player.play(songs, i)}>
                  <span className="pl-song__num tabular">{isCurrent && player.playing ? <span className="eq" aria-hidden="true"><i /><i /><i /></span> : num(i + 1)}</span>
                  <span className="pl-song__text">
                    <strong>{song.title}</strong>
                    {song.artist && <small>{song.artist}</small>}
                  </span>
                  <span className="pl-song__time tabular">{num(formatTrackTime(song.durationSec))}</span>
                </button>
                <IconButton
                  label={t.removeSong(song.title)}
                  onClick={() => {
                    player.forget([song.id]);
                    void deleteSong(song);
                  }}
                >
                  <X size={14} />
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}

      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.deletePlaylistQ}
        message={t.deletePlaylistMsg(playlist.name, songs.length)}
        onConfirm={removePlaylist}
      />
    </div>
  );
}
