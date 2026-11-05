#[cfg(desktop)]
mod ai;
mod audio;
mod db;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // "Choose a model file…" for the local assistant, which only exists on desktop.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Database::open(dir.join("life-os.db"))?;
            // Lets the player stream songs from the audio folder, and nothing else on disk.
            let audio = dir.join("audio");
            std::fs::create_dir_all(&audio)?;
            app.asset_protocol_scope().allow_directory(&audio, true)?;
            app.manage(database);
            // The worker thread starts empty; a model only loads when the assistant asks for one.
            #[cfg(desktop)]
            app.manage(ai::init(app.handle())?);
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
            audio::audio_path,
            #[cfg(desktop)]
            ai::ai_status,
            #[cfg(desktop)]
            ai::ai_models,
            #[cfg(desktop)]
            ai::ai_load,
            #[cfg(desktop)]
            ai::ai_unload,
            #[cfg(desktop)]
            ai::ai_set_idle_unload,
            #[cfg(desktop)]
            ai::ai_generate,
            #[cfg(desktop)]
            ai::ai_cancel,
            #[cfg(desktop)]
            ai::ai_import_model,
            #[cfg(desktop)]
            ai::ai_download_model,
            #[cfg(desktop)]
            ai::ai_delete_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
