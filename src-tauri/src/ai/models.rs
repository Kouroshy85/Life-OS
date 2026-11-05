//! Model files: the download catalog, the models folder, GGUF header checks, imports and downloads.
//!
//! Every model lives directly in `app_data_dir()/models`. Names that reach a path are checked
//! first, downloads only come from the catalog below, and a file only gets its final name once
//! it is complete and verified, so a broken or partial model is never offered for loading.

use super::{memory::ModelShape, AiError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub struct CatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub file_name: &'static str,
    /// Pinned to a repository revision, so the bytes behind the URL can never change.
    pub url: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
    pub min_ram_mb: u64,
    pub licence: &'static str,
}

/// Approved sources (unsloth's GGUF builds of Qwen3.5, Apache-2.0). Anything else has to be imported.
pub const CATALOG: [CatalogEntry; 2] = [
    CatalogEntry {
        id: "qwen3.5-2b-q4_k_m",
        name: "Qwen3.5 2B",
        file_name: "Qwen3.5-2B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf",
        size_bytes: 1_280_835_840,
        sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
        min_ram_mb: 3_100,
        licence: "Apache-2.0",
    },
    CatalogEntry {
        id: "qwen3.5-4b-q4_k_m",
        name: "Qwen3.5 4B",
        file_name: "Qwen3.5-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf",
        size_bytes: 2_740_937_888,
        sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
        min_ram_mb: 5_300,
        licence: "Apache-2.0",
    },
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub installed: bool,
    pub min_ram_mb: u64,
    pub licence: String,
    pub catalog: bool,
}

pub fn catalog_entry(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|e| e.id == id)
}

pub fn models_dir(app_data: &Path) -> PathBuf {
    app_data.join("models")
}

/// File names that may become a path inside the models folder: no separators, no `..`, `.gguf` only.
pub fn checked_file_name(name: &str) -> Result<&str, AiError> {
    let ok = name.len() <= 128
        && name.to_ascii_lowercase().ends_with(".gguf")
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(name)
    } else {
        Err(AiError::new("invalid_model", format!("\"{name}\" is not a usable model file name")))
    }
}

/// Turns any file name into one `checked_file_name` accepts.
fn safe_file_name(original: &str) -> String {
    let stem = original.strip_suffix(".gguf").or_else(|| original.strip_suffix(".GGUF")).unwrap_or(original);
    let mut clean: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .take(100)
        .collect();
    clean = clean.trim_start_matches('.').to_string();
    if clean.is_empty() {
        clean = "model".into();
    }
    format!("{clean}.gguf")
}

/// Resolves a model id to its file. Catalog ids map to their file name, imported models use theirs.
pub fn model_path(dir: &Path, id: &str) -> Result<PathBuf, AiError> {
    let name = match catalog_entry(id) {
        Some(entry) => entry.file_name,
        None => checked_file_name(id)?,
    };
    Ok(dir.join(name))
}

pub fn list(dir: &Path) -> Vec<ModelInfo> {
    let mut out: Vec<ModelInfo> = CATALOG
        .iter()
        .map(|e| {
            let size = fs::metadata(dir.join(e.file_name)).map(|m| m.len()).ok();
            ModelInfo {
                id: e.id.into(),
                name: e.name.into(),
                file_name: e.file_name.into(),
                size_bytes: e.size_bytes,
                installed: size == Some(e.size_bytes),
                min_ram_mb: e.min_ram_mb,
                licence: e.licence.into(),
                catalog: true,
            }
        })
        .collect();
    let Ok(entries) = fs::read_dir(dir) else { return out };
    let mut imported: Vec<ModelInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            checked_file_name(&name).ok()?;
            if CATALOG.iter().any(|e| e.file_name == name) || !entry.file_type().ok()?.is_file() {
                return None;
            }
            imported_info(&entry.path(), &name).ok()
        })
        .collect();
    imported.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    out.extend(imported);
    out
}

fn imported_info(path: &Path, file_name: &str) -> Result<ModelInfo, AiError> {
    let header = read_header(path)?;
    let size = fs::metadata(path).map_err(io_err("invalid_model"))?.len();
    let shape = header.shape(size);
    Ok(ModelInfo {
        id: file_name.into(),
        name: header.name.clone().unwrap_or_else(|| file_name.trim_end_matches(".gguf").into()),
        file_name: file_name.into(),
        size_bytes: size,
        installed: true,
        min_ram_mb: super::memory::min_ram_mb(&shape),
        licence: header.licence.clone().unwrap_or_else(|| "unknown".into()),
        catalog: false,
    })
}

pub fn info(dir: &Path, id: &str) -> Result<ModelInfo, AiError> {
    if catalog_entry(id).is_some() {
        return list(dir).into_iter().find(|m| m.id == id).ok_or_else(|| AiError::model_missing(id));
    }
    let name = checked_file_name(id)?;
    let path = dir.join(name);
    if !path.is_file() {
        return Err(AiError::model_missing(id));
    }
    imported_info(&path, name)
}

// ---------------------------------------------------------------------------------------------
// GGUF header

pub const GGUF_MAGIC: &[u8; 4] = b"GGUF";

/// What the app needs from a GGUF header: names for the UI and the sizes for the memory estimate.
#[derive(Debug, Default, Clone)]
pub struct GgufHeader {
    pub arch: String,
    pub name: Option<String>,
    pub licence: Option<String>,
    pub file_type: Option<u32>,
    /// Scalar integers keyed without the `{arch}.` prefix (`block_count`, `attention.head_count`, ...).
    /// Per-layer arrays are stored as their largest value.
    pub ints: HashMap<String, u64>,
    pub vocab_size: u64,
}

impl GgufHeader {
    fn int(&self, key: &str) -> Option<u64> {
        self.ints.get(key).copied()
    }

    pub fn quant(&self) -> String {
        // Values of llama_ftype in llama.h.
        let name = match self.file_type {
            Some(0) => "F32",
            Some(1) => "F16",
            Some(2) => "Q4_0",
            Some(3) => "Q4_1",
            Some(7) => "Q8_0",
            Some(8) => "Q5_0",
            Some(9) => "Q5_1",
            Some(10) => "Q2_K",
            Some(11) => "Q3_K_S",
            Some(12) => "Q3_K_M",
            Some(13) => "Q3_K_L",
            Some(14) => "Q4_K_S",
            Some(15) => "Q4_K_M",
            Some(16) => "Q5_K_S",
            Some(17) => "Q5_K_M",
            Some(18) => "Q6_K",
            Some(32) => "BF16",
            Some(n) => return format!("type {n}"),
            None => "unknown",
        };
        name.into()
    }

    pub fn shape(&self, file_size: u64) -> ModelShape {
        let n_embd = self.int("embedding_length").unwrap_or(0);
        let n_head = self.int("attention.head_count").unwrap_or(0);
        let head_dim = if n_head > 0 { n_embd / n_head } else { 0 };
        ModelShape {
            file_size,
            n_layer: self.int("block_count").unwrap_or(0),
            n_embd,
            n_ff: self.int("feed_forward_length").unwrap_or(n_embd * 4),
            n_head,
            n_head_kv: self.int("attention.head_count_kv").unwrap_or(n_head),
            key_len: self.int("attention.key_length").unwrap_or(head_dim),
            value_len: self.int("attention.value_length").unwrap_or(head_dim),
            full_attention_interval: self.int("full_attention_interval"),
            n_vocab: self.vocab_size,
            ssm_inner: self.int("ssm.inner_size").unwrap_or(0),
            ssm_state: self.int("ssm.state_size").unwrap_or(0),
            ssm_conv_kernel: self.int("ssm.conv_kernel").unwrap_or(0),
        }
    }
}

/// True when the file starts with the GGUF magic bytes and a supported version.
pub fn has_gguf_magic(path: &Path) -> bool {
    let mut head = [0u8; 8];
    File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok()
        && &head[..4] == GGUF_MAGIC
        && matches!(u32::from_le_bytes([head[4], head[5], head[6], head[7]]), 2 | 3)
}

pub fn read_header(path: &Path) -> Result<GgufHeader, AiError> {
    let file = File::open(path).map_err(io_err("invalid_model"))?;
    parse_header(&mut BufReader::with_capacity(1 << 16, file))
        .map_err(|e| AiError::new("invalid_model", format!("Not a usable GGUF model: {e}")))
}

const MAX_STRING: u64 = 64 << 20;

pub fn parse_header<R: Read + Seek>(r: &mut R) -> io::Result<GgufHeader> {
    let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidData, m.to_string());
    let mut magic = [0u8; 4];
    r.read_exact(&mut magic)?;
    if &magic != GGUF_MAGIC {
        return Err(bad("missing GGUF magic bytes"));
    }
    let version = read_u32(r)?;
    if !matches!(version, 2 | 3) {
        return Err(bad(&format!("unsupported GGUF version {version}")));
    }
    let _tensors = read_u64(r)?;
    let kv_count = read_u64(r)?;
    if kv_count > 100_000 {
        return Err(bad("implausible metadata count"));
    }
    let mut header = GgufHeader::default();
    let mut raw_ints: Vec<(String, u64)> = Vec::new();
    for _ in 0..kv_count {
        let key = read_string(r)?;
        let ty = read_u32(r)?;
        match ty {
            8 => {
                let value = read_string(r)?;
                match key.as_str() {
                    "general.architecture" => header.arch = value,
                    "general.name" => header.name = Some(value),
                    "general.license" => header.licence = Some(value),
                    _ => {}
                }
            }
            9 => {
                let elem = read_u32(r)?;
                let count = read_u64(r)?;
                if key == "tokenizer.ggml.tokens" {
                    header.vocab_size = count;
                }
                let mut largest = None;
                for _ in 0..count {
                    match read_value(r, elem)? {
                        Some(v) => largest = Some(largest.map_or(v, |l: u64| l.max(v))),
                        None if elem == 9 => return Err(bad("nested metadata arrays")),
                        None => {}
                    }
                }
                if let Some(v) = largest {
                    raw_ints.push((key, v));
                }
            }
            _ => {
                if let Some(v) = read_value(r, ty)? {
                    if key == "general.file_type" {
                        header.file_type = Some(v as u32);
                    }
                    raw_ints.push((key, v));
                }
            }
        }
    }
    if header.arch.is_empty() {
        return Err(bad("no general.architecture"));
    }
    let prefix = format!("{}.", header.arch);
    header.ints = raw_ints
        .into_iter()
        .filter_map(|(k, v)| k.strip_prefix(&prefix).map(|k| (k.to_string(), v)))
        .collect();
    Ok(header)
}

/// Reads one metadata value, returning integers (and bools) and skipping everything else.
fn read_value<R: Read + Seek>(r: &mut R, ty: u32) -> io::Result<Option<u64>> {
    let mut buf = [0u8; 8];
    let v = match ty {
        0 | 1 | 7 => {
            r.read_exact(&mut buf[..1])?;
            Some(if ty == 1 { (buf[0] as i8).max(0) as u64 } else { buf[0] as u64 })
        }
        2 | 3 => {
            r.read_exact(&mut buf[..2])?;
            let v = u16::from_le_bytes([buf[0], buf[1]]);
            Some(if ty == 3 { (v as i16).max(0) as u64 } else { v as u64 })
        }
        4 | 5 => {
            let v = read_u32(r)?;
            Some(if ty == 5 { (v as i32).max(0) as u64 } else { v as u64 })
        }
        6 => {
            r.seek(SeekFrom::Current(4))?;
            None
        }
        8 => {
            let len = read_u64(r)?;
            if len > MAX_STRING {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "string too long"));
            }
            r.seek(SeekFrom::Current(len as i64))?;
            None
        }
        10 | 11 => {
            let v = read_u64(r)?;
            Some(if ty == 11 { (v as i64).max(0) as u64 } else { v })
        }
        12 => {
            r.seek(SeekFrom::Current(8))?;
            None
        }
        9 => None,
        _ => return Err(io::Error::new(io::ErrorKind::InvalidData, format!("unknown metadata type {ty}"))),
    };
    Ok(v)
}

fn read_u32<R: Read>(r: &mut R) -> io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn read_string<R: Read>(r: &mut R) -> io::Result<String> {
    let len = read_u64(r)?;
    if len > MAX_STRING {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "string too long"));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

// ---------------------------------------------------------------------------------------------
// Hashing, import and download

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Streams a file through SHA-256 and returns the lowercase hex digest.
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut hasher = Sha256::new();
    hash_into(&mut hasher, &mut File::open(path)?)?;
    Ok(hex(&hasher.finalize()))
}

fn hash_into(hasher: &mut Sha256, r: &mut impl Read) -> io::Result<u64> {
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            return Ok(total);
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
}

pub fn verify_sha256(path: &Path, expected: &str) -> io::Result<bool> {
    Ok(sha256_file(path)?.eq_ignore_ascii_case(expected))
}

fn io_err(code: &'static str) -> impl Fn(io::Error) -> AiError {
    move |e| AiError::new(code, e.to_string())
}

/// Copies a GGUF the user picked into the models folder. The header is checked before anything
/// is written, the copy goes to a temporary name, and only a complete copy is renamed into place.
pub fn import(dir: &Path, source: &Path) -> Result<ModelInfo, AiError> {
    if !source.is_file() {
        return Err(AiError::new("invalid_model", "That file doesn't exist"));
    }
    if !has_gguf_magic(source) {
        return Err(AiError::new("invalid_model", "That file isn't a GGUF model"));
    }
    read_header(source)?;
    fs::create_dir_all(dir).map_err(io_err("invalid_model"))?;
    let original = source.file_name().and_then(|n| n.to_str()).unwrap_or("model.gguf");
    let mut name = safe_file_name(original);
    // A file that looks like a catalog model only takes its place when it really is that model.
    if let Some(entry) = CATALOG.iter().find(|e| e.file_name.eq_ignore_ascii_case(&name)) {
        let same = verify_sha256(source, entry.sha256).map_err(io_err("invalid_model"))?;
        if same {
            name = entry.file_name.to_string();
        } else {
            name = format!("imported-{name}");
        }
    }
    let target = unused_name(dir, &name);
    let part = part_path(&target);
    let copied = fs::copy(source, &part).map_err(io_err("invalid_model"));
    if let Err(e) = copied.and_then(|_| fs::rename(&part, &target).map_err(io_err("invalid_model"))) {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let file_name = target.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
    match CATALOG.iter().find(|e| e.file_name == file_name) {
        Some(entry) => info(dir, entry.id),
        None => imported_info(&target, &file_name),
    }
}

fn unused_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() || CATALOG.iter().any(|e| e.file_name == name) {
        return first;
    }
    let stem = name.trim_end_matches(".gguf");
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}.gguf")))
        .find(|p| !p.exists())
        .expect("some free name")
}

pub fn part_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    target.with_file_name(name)
}

/// Downloads a catalog model. Bytes go to `<file>.part`; an interrupted download resumes from
/// where it stopped (the existing bytes are hashed first). The whole file has to match the
/// catalog's SHA-256 before it is renamed into place; a mismatch deletes the partial file.
pub async fn download(
    dir: &Path,
    entry: &CatalogEntry,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), AiError> {
    let fail = |m: String| AiError::new("download_failed", m);
    fs::create_dir_all(dir).map_err(|e| fail(e.to_string()))?;
    let target = dir.join(entry.file_name);
    let part = part_path(&target);
    let total = entry.size_bytes;

    // Hash what is already there, off the async runtime.
    let (mut hasher, mut received) = {
        let part = part.clone();
        tauri::async_runtime::spawn_blocking(move || -> io::Result<(Sha256, u64)> {
            let mut hasher = Sha256::new();
            let have = match File::open(&part) {
                Ok(mut f) => hash_into(&mut hasher, &mut f)?,
                Err(_) => 0,
            };
            Ok((hasher, have))
        })
        .await
        .map_err(|e| fail(e.to_string()))?
        .map_err(|e| fail(e.to_string()))?
    };
    if received > total {
        let _ = fs::remove_file(&part);
        hasher = Sha256::new();
        received = 0;
    }
    on_progress(received, total);

    let client = reqwest::Client::builder()
        .user_agent(concat!("LifeOS/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| fail(e.to_string()))?;

    let mut attempts = 0;
    while received < total {
        attempts += 1;
        match fetch_from(&client, entry.url, &part, &mut hasher, &mut received, total, &mut on_progress).await {
            Ok(()) => attempts = 0,
            Err(Fetch::Restart) => {
                // The server ignored the range request, so start the file again.
                let _ = fs::remove_file(&part);
                hasher = Sha256::new();
                received = 0;
            }
            Err(Fetch::Fatal(m)) => return Err(fail(m)),
            Err(Fetch::Retry(m)) if attempts >= 8 => {
                return Err(fail(format!("{m} (the partial download is kept and resumes next time)")))
            }
            Err(Fetch::Retry(_)) => {
                tokio_sleep(std::time::Duration::from_secs(2u64.pow(attempts.min(4)))).await;
            }
        }
    }

    let digest = hex(&hasher.finalize());
    if received != total || !digest.eq_ignore_ascii_case(entry.sha256) {
        let _ = fs::remove_file(&part);
        return Err(fail(format!("The downloaded file failed its SHA-256 check (got {digest}) and was removed")));
    }
    fs::rename(&part, &target).map_err(|e| fail(e.to_string()))?;
    Ok(())
}

enum Fetch {
    Retry(String),
    Restart,
    Fatal(String),
}

async fn fetch_from(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    hasher: &mut Sha256,
    received: &mut u64,
    total: u64,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<(), Fetch> {
    let mut request = client.get(url);
    if *received > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
    }
    let mut response = request.send().await.map_err(|e| Fetch::Retry(e.to_string()))?;
    let status = response.status();
    if *received > 0 && status == reqwest::StatusCode::OK {
        return Err(Fetch::Restart);
    }
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        return Err(Fetch::Restart);
    }
    if !status.is_success() {
        let message = format!("The server answered {status}");
        return Err(if status.is_server_error() || status.as_u16() == 429 { Fetch::Retry(message) } else { Fetch::Fatal(message) });
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(part)
        .map_err(|e| Fetch::Fatal(e.to_string()))?;
    let mut last_report = std::time::Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| Fetch::Retry(e.to_string()))? {
        if *received + chunk.len() as u64 > total {
            return Err(Fetch::Fatal("The server sent more data than expected".into()));
        }
        file.write_all(&chunk).map_err(|e| Fetch::Fatal(e.to_string()))?;
        hasher.update(&chunk);
        *received += chunk.len() as u64;
        if last_report.elapsed().as_millis() >= 150 {
            last_report = std::time::Instant::now();
            on_progress(*received, total);
        }
    }
    file.flush().map_err(|e| Fetch::Fatal(e.to_string()))?;
    on_progress(*received, total);
    if *received < total {
        return Err(Fetch::Retry("The connection closed early".into()));
    }
    Ok(())
}

async fn tokio_sleep(d: std::time::Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn kv_str(out: &mut Vec<u8>, key: &str, value: &str) {
        out.extend((key.len() as u64).to_le_bytes());
        out.extend(key.as_bytes());
        out.extend(8u32.to_le_bytes());
        out.extend((value.len() as u64).to_le_bytes());
        out.extend(value.as_bytes());
    }

    fn kv_u32(out: &mut Vec<u8>, key: &str, value: u32) {
        out.extend((key.len() as u64).to_le_bytes());
        out.extend(key.as_bytes());
        out.extend(4u32.to_le_bytes());
        out.extend(value.to_le_bytes());
    }

    /// A tiny but well-formed GGUF header shaped like a hybrid Qwen3.5 model.
    pub(crate) fn sample_header() -> Vec<u8> {
        let mut out = b"GGUF".to_vec();
        out.extend(3u32.to_le_bytes());
        out.extend(0u64.to_le_bytes());
        out.extend(8u64.to_le_bytes());
        kv_str(&mut out, "general.architecture", "qwen35");
        kv_str(&mut out, "general.name", "Test Model");
        kv_u32(&mut out, "general.file_type", 15);
        kv_u32(&mut out, "qwen35.block_count", 24);
        kv_u32(&mut out, "qwen35.full_attention_interval", 4);
        kv_u32(&mut out, "qwen35.attention.head_count", 8);
        // A per-layer array, stored as its largest value.
        let key = "qwen35.attention.head_count_kv";
        out.extend((key.len() as u64).to_le_bytes());
        out.extend(key.as_bytes());
        out.extend(9u32.to_le_bytes());
        out.extend(4u32.to_le_bytes());
        out.extend(3u64.to_le_bytes());
        for v in [0u32, 2, 0] {
            out.extend(v.to_le_bytes());
        }
        // A string array, skipped but counted.
        let key = "tokenizer.ggml.tokens";
        out.extend((key.len() as u64).to_le_bytes());
        out.extend(key.as_bytes());
        out.extend(9u32.to_le_bytes());
        out.extend(8u32.to_le_bytes());
        out.extend(2u64.to_le_bytes());
        for t in ["a", "bc"] {
            out.extend((t.len() as u64).to_le_bytes());
            out.extend(t.as_bytes());
        }
        out
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lifeos-ai-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_gguf_header() {
        let h = parse_header(&mut Cursor::new(sample_header())).unwrap();
        assert_eq!(h.arch, "qwen35");
        assert_eq!(h.name.as_deref(), Some("Test Model"));
        assert_eq!(h.quant(), "Q4_K_M");
        assert_eq!(h.vocab_size, 2);
        let shape = h.shape(1000);
        assert_eq!(shape.n_layer, 24);
        assert_eq!(shape.n_head_kv, 2);
        assert_eq!(shape.full_attention_interval, Some(4));
    }

    #[test]
    fn rejects_files_that_are_not_gguf() {
        assert!(parse_header(&mut Cursor::new(b"GGML\x03\0\0\0".to_vec())).is_err());
        let mut wrong_version = sample_header();
        wrong_version[4] = 9;
        assert!(parse_header(&mut Cursor::new(wrong_version)).is_err());
        let truncated = sample_header()[..40].to_vec();
        assert!(parse_header(&mut Cursor::new(truncated)).is_err());

        let dir = temp_dir("magic");
        let good = dir.join("good.gguf");
        let bad = dir.join("bad.gguf");
        fs::write(&good, sample_header()).unwrap();
        fs::write(&bad, b"PK\x03\x04 not a model").unwrap();
        assert!(has_gguf_magic(&good));
        assert!(!has_gguf_magic(&bad));
        assert!(!has_gguf_magic(&dir.join("missing.gguf")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sha256_matches_known_digests() {
        assert_eq!(hex(&Sha256::digest(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let dir = temp_dir("sha");
        let file = dir.join("abc.bin");
        fs::write(&file, b"abc").unwrap();
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(sha256_file(&file).unwrap(), abc);
        assert!(verify_sha256(&file, &abc.to_uppercase()).unwrap());
        assert!(!verify_sha256(&file, &CATALOG[0].sha256).unwrap());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn model_paths_stay_inside_the_models_folder() {
        let data = Path::new("C:/data/app.lifeos.desktop");
        let dir = models_dir(data);
        assert_eq!(dir, data.join("models"));
        assert_eq!(model_path(&dir, "qwen3.5-2b-q4_k_m").unwrap(), dir.join("Qwen3.5-2B-Q4_K_M.gguf"));
        assert_eq!(model_path(&dir, "my-model.gguf").unwrap(), dir.join("my-model.gguf"));
        for bad in ["../x.gguf", "..\\x.gguf", "C:/x.gguf", "a/b.gguf", "x.bin", ".hidden.gguf", "", "a b.gguf"] {
            assert!(model_path(&dir, bad).is_err(), "{bad} should be refused");
        }
        assert_eq!(safe_file_name("My Model (v2).GGUF"), "My_Model__v2_.gguf");
        assert_eq!(safe_file_name("..gguf"), "model.gguf");
        assert!(checked_file_name(&safe_file_name("../../etc/passwd")).is_ok());
    }

    /// Resumes a catalog download over the network from a partial file seeded with all but the
    /// last 40 MB of the real model, then checks that a corrupted partial file is rejected.
    #[test]
    #[ignore = "uses the network and LIFEOS_TEST_MODEL (the catalog's 2B file)"]
    fn real_download_resumes_and_verifies() {
        let source = PathBuf::from(std::env::var("LIFEOS_TEST_MODEL").expect("set LIFEOS_TEST_MODEL"));
        let entry = &CATALOG[0];
        let seeded = entry.size_bytes - (40 << 20);
        let seed = |dir: &Path, corrupt: bool| {
            let mut from = File::open(&source).unwrap();
            let mut to = File::create(part_path(&dir.join(entry.file_name))).unwrap();
            io::copy(&mut (&mut from).take(seeded), &mut to).unwrap();
            if corrupt {
                to.seek(SeekFrom::Start(1 << 20)).unwrap();
                to.write_all(&[0x5A]).unwrap();
            }
        };

        let dir = temp_dir("download");
        seed(&dir, false);
        let mut first_report = None;
        let mut last = (0, 0);
        tauri::async_runtime::block_on(download(&dir, entry, |received, total| {
            first_report.get_or_insert(received);
            last = (received, total);
        }))
        .expect("download resumes and verifies");
        assert_eq!(first_report, Some(seeded), "resumed from the partial file");
        assert_eq!(last, (entry.size_bytes, entry.size_bytes));
        let target = dir.join(entry.file_name);
        assert_eq!(fs::metadata(&target).unwrap().len(), entry.size_bytes);
        assert!(!part_path(&target).exists());
        assert!(list(&dir)[0].installed);
        fs::remove_file(&target).unwrap();

        seed(&dir, true);
        let err = tauri::async_runtime::block_on(download(&dir, entry, |_, _| {})).unwrap_err();
        assert_eq!(err.code, "download_failed");
        assert!(err.message.contains("SHA-256"), "{}", err.message);
        assert!(!part_path(&target).exists() && !target.exists(), "the bad file is gone");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn import_checks_and_copies_into_the_models_folder() {
        let dir = temp_dir("import");
        let models = models_dir(&dir);
        let source = dir.join("Some Model.gguf");
        fs::write(&source, sample_header()).unwrap();
        let info = import(&models, &source).unwrap();
        assert_eq!(info.file_name, "Some_Model.gguf");
        assert_eq!(info.name, "Test Model");
        assert!(!info.catalog && info.installed);
        assert!(models.join("Some_Model.gguf").is_file());
        assert!(!part_path(&models.join("Some_Model.gguf")).exists());
        // Importing again keeps both files instead of overwriting.
        assert_eq!(import(&models, &source).unwrap().file_name, "Some_Model-2.gguf");
        // A fake file named like a catalog model doesn't take its place.
        let fake = dir.join(CATALOG[0].file_name);
        fs::write(&fake, sample_header()).unwrap();
        assert!(import(&models, &fake).unwrap().file_name.starts_with("imported-"));
        let not_model = dir.join("notes.gguf");
        fs::write(&not_model, b"hello").unwrap();
        assert_eq!(import(&models, &not_model).unwrap_err().code, "invalid_model");
        let listed: Vec<String> = list(&models).into_iter().map(|m| m.id).collect();
        assert_eq!(listed.len(), 5);
        assert!(listed.contains(&"Some_Model.gguf".to_string()));
        let _ = fs::remove_dir_all(dir);
    }
}
