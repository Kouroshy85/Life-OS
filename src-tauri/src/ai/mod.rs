//! Offline planning assistant: llama.cpp running inside the app, desktop only.
//!
//! The frontend reaches the model only through the `ai_*` commands below. There is no server,
//! no port and no cloud call; the only network access is the optional download of a catalog
//! model, from the pinned URL in `models::CATALOG`.

mod engine;
mod memory;
mod models;

use engine::{Engine, GenerateRequest, GenerateResult, LoadTarget, LoadedModel};
use models::ModelInfo;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Debug, Clone)]
pub struct AiError {
    pub code: &'static str,
    pub message: String,
}

impl AiError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        AiError { code, message: message.into() }
    }

    pub fn model_missing(id: &str) -> Self {
        AiError::new("model_missing", format!("The model \"{id}\" isn't installed"))
    }
}

pub struct AiState {
    engine: Engine,
    dir: PathBuf,
    downloads: Arc<Mutex<HashSet<String>>>,
}

pub fn init(app: &AppHandle) -> Result<AiState, Box<dyn std::error::Error>> {
    let dir = models::models_dir(&app.path().app_data_dir()?);
    std::fs::create_dir_all(&dir)?;
    Ok(AiState { engine: Engine::new(), dir, downloads: Arc::new(Mutex::new(HashSet::new())) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    llama_cpp: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    available: bool,
    state: &'static str,
    runtime: Runtime,
    loaded: Option<LoadedModel>,
    ram_total_mb: u64,
    ram_available_mb: u64,
    idle_unload_min: u32,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GenerateEvent {
    Token { text: String },
    Done,
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    received: u64,
    total: u64,
}

fn target_for(dir: &Path, id: &str) -> Result<LoadTarget, AiError> {
    let path = models::model_path(dir, id)?;
    if !path.is_file() {
        return Err(AiError::model_missing(id));
    }
    let name = models::catalog_entry(id).map(|e| e.name.to_string());
    Ok(LoadTarget { id: id.to_string(), path, name })
}

/// The model a message uses when nothing is loaded: the last one used, else the first installed.
fn default_target(engine: &Engine, dir: &Path) -> Result<LoadTarget, AiError> {
    if let Some(loaded) = engine.loaded() {
        return target_for(dir, &loaded.id);
    }
    if let Some(target) = engine.last_model().and_then(|id| target_for(dir, &id).ok()) {
        return Ok(target);
    }
    models::list(dir)
        .into_iter()
        .find(|m| m.installed)
        .ok_or_else(|| AiError::new("model_missing", "No model is installed yet. Download one or choose a model file."))
        .and_then(|m| target_for(dir, &m.id))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, AiError> + Send + 'static, code: &'static str) -> Result<T, AiError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Err(AiError::new(code, format!("The task stopped unexpectedly: {e}"))))
}

#[tauri::command(async)]
pub fn ai_status(state: State<'_, AiState>) -> AiStatus {
    let ram = memory::ram();
    AiStatus {
        available: engine::cpu_supported(),
        state: state.engine.state().as_str(),
        runtime: Runtime { llama_cpp: engine::LLAMA_CPP_BUILD },
        loaded: state.engine.loaded(),
        ram_total_mb: ram.total_mb(),
        ram_available_mb: ram.available_mb(),
        idle_unload_min: state.engine.idle_unload_min(),
    }
}

#[tauri::command(async)]
pub fn ai_models(state: State<'_, AiState>) -> Vec<ModelInfo> {
    models::list(&state.dir)
}

#[tauri::command]
pub async fn ai_load(state: State<'_, AiState>, model_id: String) -> Result<LoadedModel, AiError> {
    let target = target_for(&state.dir, &model_id)?;
    let engine = state.engine.clone();
    blocking(move || engine.load(target), "load_failed").await
}

#[tauri::command]
pub async fn ai_unload(state: State<'_, AiState>) -> Result<(), AiError> {
    let engine = state.engine.clone();
    blocking(move || Ok(engine.unload()), "load_failed").await
}

#[tauri::command(async)]
pub fn ai_set_idle_unload(state: State<'_, AiState>, minutes: u32) {
    state.engine.set_idle_unload(minutes);
}

#[tauri::command]
pub async fn ai_generate(
    state: State<'_, AiState>,
    request: GenerateRequest,
    on_event: Channel<GenerateEvent>,
) -> Result<GenerateResult, AiError> {
    let target = default_target(&state.engine, &state.dir)?;
    let engine = state.engine.clone();
    let events = on_event.clone();
    let result = blocking(
        move || {
            engine.generate(target, request, move |text| {
                let _ = events.send(GenerateEvent::Token { text: text.to_string() });
            })
        },
        "generation_failed",
    )
    .await;
    let _ = on_event.send(GenerateEvent::Done);
    result
}

#[tauri::command(async)]
pub fn ai_cancel(state: State<'_, AiState>, request_id: String) {
    state.engine.cancel(&request_id);
}

#[tauri::command]
pub async fn ai_import_model(state: State<'_, AiState>, path: String) -> Result<ModelInfo, AiError> {
    let dir = state.dir.clone();
    blocking(move || models::import(&dir, Path::new(&path)), "invalid_model").await
}

/// Removes the claim on a download when the download ends, however it ends.
struct DownloadClaim(Arc<Mutex<HashSet<String>>>, String);

impl Drop for DownloadClaim {
    fn drop(&mut self) {
        self.0.lock().unwrap().remove(&self.1);
    }
}

#[tauri::command]
pub async fn ai_download_model(
    state: State<'_, AiState>,
    model_id: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<ModelInfo, AiError> {
    let entry = models::catalog_entry(&model_id)
        .ok_or_else(|| AiError::new("download_failed", "Only models from the built-in list can be downloaded"))?;
    if let Ok(info) = models::info(&state.dir, entry.id) {
        if info.installed {
            return Ok(info);
        }
    }
    if !state.downloads.lock().unwrap().insert(model_id.clone()) {
        return Err(AiError::new("download_failed", "This model is already downloading"));
    }
    let _claim = DownloadClaim(state.downloads.clone(), model_id.clone());
    models::download(&state.dir, entry, |received, total| {
        let _ = on_progress.send(DownloadProgress { received, total });
    })
    .await?;
    models::info(&state.dir, entry.id)
}

#[tauri::command]
pub async fn ai_delete_model(state: State<'_, AiState>, model_id: String) -> Result<(), AiError> {
    let path = models::model_path(&state.dir, &model_id)?;
    if state.engine.in_use(&model_id) {
        return Err(AiError::new("invalid_model", "This model is loaded. Unload it before deleting it."));
    }
    if state.downloads.lock().unwrap().contains(&model_id) {
        return Err(AiError::new("invalid_model", "This model is still downloading"));
    }
    let part = models::part_path(&path);
    let had_part = part.exists();
    let _ = std::fs::remove_file(&part);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && had_part => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AiError::model_missing(&model_id)),
        Err(e) => Err(AiError::new("invalid_model", e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::engine::{ChatMessage, Role};
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    /// Run with `LIFEOS_TEST_MODEL=<path to a Qwen3.5 GGUF> cargo test --release -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs a real GGUF in LIFEOS_TEST_MODEL"]
    fn real_model_generates_schema_constrained_json() {
        let path = PathBuf::from(std::env::var("LIFEOS_TEST_MODEL").expect("set LIFEOS_TEST_MODEL"));
        let file_size = std::fs::metadata(&path).unwrap().len();
        let header = models::read_header(&path).unwrap();
        let est = memory::estimate(&header.shape(file_size), memory::N_CTX, memory::N_UBATCH);
        println!("arch={} quant={} estimate={est:?} required={} MB", header.arch, header.quant(), est.required() >> 20);

        // Track this process's peak working set while the model is in use.
        let peak = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let watcher = {
            let (peak, stop) = (peak.clone(), stop.clone());
            std::thread::spawn(move || {
                let pid = sysinfo::get_current_pid().unwrap();
                let mut sys = sysinfo::System::new().unwrap();
                while !stop.load(Ordering::SeqCst) {
                    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
                    if let Some(p) = sys.process(pid) {
                        peak.fetch_max(p.memory(), Ordering::SeqCst);
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            })
        };

        let engine = Engine::new();
        let target = LoadTarget { id: "test".into(), path: path.clone(), name: None };
        let started = Instant::now();
        let loaded = engine.load(target.clone()).expect("model loads");
        println!("loaded {loaded:?} in {} ms", started.elapsed().as_millis());
        assert_eq!(engine.state().as_str(), "ready");

        let schema = r#"{"type":"object","properties":{
            "intent":{"type":"string","enum":["advice","clarification","propose_changes","out_of_scope"]},
            "reply":{"type":"string"},
            "tasks":{"type":"array","items":{"type":"object","properties":{
                "title":{"type":"string"},"estimate_min":{"type":"integer","minimum":5,"maximum":480}},
                "required":["title","estimate_min"],"additionalProperties":false},"maxItems":5}},
            "required":["intent","reply","tasks"],"additionalProperties":false}"#;
        let request = |id: &str, schema: Option<&str>, max_tokens| GenerateRequest {
            request_id: id.into(),
            system: "You are a planning assistant inside Life OS. Answer only with the JSON the schema asks for.".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "I have an IELTS exam in three weeks. Suggest a few study tasks.".into(),
            }],
            json_schema: schema.map(str::to_string),
            max_tokens,
            temperature: 0.7,
        };

        let streamed = Arc::new(Mutex::new(String::new()));
        let sink = streamed.clone();
        let result = engine
            .generate(target.clone(), request("r1", Some(schema), 400), move |t| sink.lock().unwrap().push_str(t))
            .expect("generation works");
        let tps = result.tokens as f64 / (result.ms as f64 / 1000.0);
        println!("result: {} tokens in {} ms ({tps:.1} tok/s incl. prompt), stop={:?}", result.tokens, result.ms, result.stop_reason);
        println!("{}", result.text);
        assert_eq!(*streamed.lock().unwrap(), result.text, "streamed text matches the result");
        let json: serde_json::Value = serde_json::from_str(&result.text).expect("valid JSON");
        assert!(["advice", "clarification", "propose_changes", "out_of_scope"].contains(&json["intent"].as_str().unwrap()));
        assert!(json["reply"].is_string());
        for task in json["tasks"].as_array().unwrap() {
            let est = task["estimate_min"].as_i64().unwrap();
            assert!((5..=480).contains(&est), "estimate {est}");
        }
        assert!(!result.text.contains("<think>"), "thinking stays off");

        // Token limit.
        let short = engine.generate(target.clone(), request("r2", None, 8), |_| {}).unwrap();
        assert_eq!(short.stop_reason, engine::StopReason::Length);
        assert_eq!(short.tokens, 8);

        // Cancelling from another thread stops between tokens.
        let canceller = engine.clone();
        let cancelled = engine
            .generate(target.clone(), request("r3", None, 2000), move |_| canceller.cancel("r3"))
            .unwrap();
        assert_eq!(cancelled.stop_reason, engine::StopReason::Cancelled);
        assert!(cancelled.tokens <= 3);
        // A cancel that arrives before the request starts.
        engine.cancel("r4");
        assert_eq!(engine.generate(target.clone(), request("r4", None, 8), |_| {}).unwrap_err().code, "cancelled");

        // Decode speed: the time to the first token is mostly the prompt, the rest is decoding.
        let first = Arc::new(Mutex::new(None::<Instant>));
        let mark = first.clone();
        let t0 = Instant::now();
        let long = engine
            .generate(target.clone(), request("r5", None, 256), move |_| {
                mark.lock().unwrap().get_or_insert_with(Instant::now);
            })
            .unwrap();
        let decode_ms = t0.elapsed().as_millis() - (first.lock().unwrap().unwrap() - t0).as_millis();
        println!(
            "free text: {} tokens in {} ms, decode {:.1} tok/s",
            long.tokens,
            long.ms,
            (long.tokens - 1) as f64 / (decode_ms as f64 / 1000.0)
        );

        // Prompt speed with a context about the size the assistant sends (~2,500 tokens).
        let mut big = request("r7", None, 1);
        big.system = "Monday: deep work 9-12, gym 18:00. Tuesday: meetings 10-11, study 19-21. ".repeat(110);
        let read = engine.generate(target.clone(), big, |_| {}).unwrap();
        println!("long prompt: read and answered in {} ms", read.ms);

        engine.unload();
        assert_eq!(engine.state().as_str(), "idle");
        assert!(engine.loaded().is_none());
        // Generating with nothing loaded loads the model again on its own.
        let lazy = engine.generate(target, request("r6", None, 4), |_| {}).unwrap();
        assert_eq!(lazy.tokens, 4);
        engine.unload();

        stop.store(true, Ordering::SeqCst);
        watcher.join().unwrap();
        println!("peak working set: {} MB (estimate {} MB)", peak.load(Ordering::SeqCst) >> 20, est.total() >> 20);
    }
}
