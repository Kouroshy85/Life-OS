mod audio;
mod db;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Database::open(dir.join("life-os.db"))?;
            // Lets the player stream songs from the audio folder, and nothing else on disk.
            let audio = dir.join("audio");
            std::fs::create_dir_all(&audio)?;
            app.asset_protocol_scope().allow_directory(&audio, true)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_execute,
            db::db_select,
            db::db_batch,
            db::db_info,
            audio::audio_begin,
            audio::audio_chunk,
            audio::audio_finish,
            audio::audio_abort,
            audio::audio_delete,
            audio::audio_clear,
            audio::audio_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
