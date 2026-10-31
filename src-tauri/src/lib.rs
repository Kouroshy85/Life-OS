mod db;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Database::open(dir.join("life-os.db"))?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_execute,
            db::db_select,
            db::db_batch,
            db::db_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
