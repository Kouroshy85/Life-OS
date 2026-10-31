//! Song files for the Relax player, kept in the app data folder.
//!
//! Uploads arrive in chunks so the UI can show real progress. A song is written to a
//! `.part` file and only gets its final name once every byte has arrived, so a cancelled
//! or failed upload never leaves a broken song behind.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const EXTENSIONS: [&str; 8] = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"];

/// Ids and extensions come from the web layer and end up in a path, so only safe values pass.
fn checked_name(id: &str, ext: &str) -> Result<String, String> {
    let id_ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !id_ok {
        return Err("invalid song id".into());
    }
    if !EXTENSIONS.contains(&ext) {
        return Err("unsupported audio format".into());
    }
    Ok(format!("{id}.{ext}"))
}

fn audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("audio");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn part_path(app: &AppHandle, id: &str, ext: &str) -> Result<PathBuf, String> {
    Ok(audio_dir(app)?.join(format!("{}.part", checked_name(id, ext)?)))
}

#[tauri::command(async)]
pub fn audio_begin(app: AppHandle, id: String, ext: String) -> Result<(), String> {
    fs::File::create(part_path(&app, &id, &ext)?).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn audio_chunk(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let id = header("x-audio-id").ok_or("missing song id")?;
    let ext = header("x-audio-ext").ok_or("missing format")?;
    let mut file = OpenOptions::new().append(true).open(part_path(&app, &id, &ext)?).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn audio_finish(app: AppHandle, id: String, ext: String) -> Result<(), String> {
    let name = checked_name(&id, &ext)?;
    fs::rename(part_path(&app, &id, &ext)?, audio_dir(&app)?.join(name)).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn audio_abort(app: AppHandle, id: String, ext: String) -> Result<(), String> {
    let _ = fs::remove_file(part_path(&app, &id, &ext)?);
    Ok(())
}

#[tauri::command(async)]
pub fn audio_delete(app: AppHandle, id: String, ext: String) -> Result<(), String> {
    let name = checked_name(&id, &ext)?;
    let _ = fs::remove_file(audio_dir(&app)?.join(name));
    Ok(())
}

#[tauri::command(async)]
pub fn audio_clear(app: AppHandle) -> Result<(), String> {
    let dir = audio_dir(&app)?;
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn audio_path(app: AppHandle, id: String, ext: String) -> Result<String, String> {
    Ok(audio_dir(&app)?.join(checked_name(&id, &ext)?).to_string_lossy().into_owned())
}
