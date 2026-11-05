//! Memory check before a model loads.
//!
//! The estimate adds up what llama.cpp actually allocates on the CPU: the weights (the whole
//! file), the KV cache for the attention layers, the recurrent state of hybrid models such as
//! Qwen3.5, the compute buffers for one micro-batch, and a fixed runtime overhead. On top of that
//! some memory always stays free for Windows and other apps, so loading never pushes the PC into
//! swapping. If the estimate doesn't fit, loading is refused instead of attempted.

use super::AiError;

const MB: u64 = 1024 * 1024;

/// Context size the engine runs with.
pub const N_CTX: u32 = 8192;
/// Tokens per micro-batch while reading the prompt. Bounds the compute buffer.
pub const N_UBATCH: u32 = 512;
/// Tokenizer tables, thread pools, the logits buffer, sampler and grammar state.
const RUNTIME_OVERHEAD: u64 = 200 * MB;
/// Memory always left for the rest of the system.
pub const HEADROOM: u64 = 512 * MB;

/// Sizes read from the GGUF header.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelShape {
    pub file_size: u64,
    pub n_layer: u64,
    pub n_embd: u64,
    pub n_ff: u64,
    pub n_head: u64,
    pub n_head_kv: u64,
    pub key_len: u64,
    pub value_len: u64,
    /// Hybrid models (Qwen3.5) only use full attention, and so a KV cache, on every n-th layer.
    pub full_attention_interval: Option<u64>,
    pub n_vocab: u64,
    pub ssm_inner: u64,
    pub ssm_state: u64,
    pub ssm_conv_kernel: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Estimate {
    pub weights: u64,
    pub kv_cache: u64,
    pub recurrent: u64,
    pub compute: u64,
    pub overhead: u64,
}

impl Estimate {
    pub fn total(&self) -> u64 {
        self.weights + self.kv_cache + self.recurrent + self.compute + self.overhead
    }

    /// What has to be available before loading: the estimate plus the memory kept free.
    pub fn required(&self) -> u64 {
        self.total() + HEADROOM
    }
}

pub fn estimate(shape: &ModelShape, n_ctx: u32, n_ubatch: u32) -> Estimate {
    let n_ctx = n_ctx as u64;
    let n_ubatch = n_ubatch as u64;
    let attention_layers = match shape.full_attention_interval {
        Some(interval) if interval > 0 => shape.n_layer.div_ceil(interval),
        _ => shape.n_layer,
    };
    let recurrent_layers = shape.n_layer - attention_layers.min(shape.n_layer);
    // F16 keys and values for every position of every attention layer.
    let kv_cache = attention_layers * n_ctx * shape.n_head_kv * (shape.key_len + shape.value_len) * 2;
    // Gated DeltaNet / Mamba-style state per recurrent layer, in F32.
    let recurrent = recurrent_layers * shape.ssm_inner * (shape.ssm_state + 2 * shape.ssm_conv_kernel) * 4;
    // llama.cpp reserves its graph for a full micro-batch of outputs: F32 logits for every token
    // (most of it, with Qwen's 248k vocabulary) plus the feed-forward and residual activations.
    // Measured with Qwen3.5-2B at a micro-batch of 512: 513 MiB; this gives 553 MiB.
    let compute = n_ubatch * 4 * (shape.n_vocab + 3 * shape.n_ff + 8 * shape.n_embd);
    // The file is memory-mapped, and on AVX2 CPUs llama.cpp also copies most quantised matrices
    // into an interleaved layout (CPU_REPACK). Measured with Qwen3.5-2B: 1211 MiB mapped plus
    // 490 MiB repacked, so the weights count as the file plus 40%.
    let weights = shape.file_size + shape.file_size * 2 / 5;
    Estimate { weights, kv_cache, recurrent, compute, overhead: RUNTIME_OVERHEAD }
}

pub fn min_ram_mb(shape: &ModelShape) -> u64 {
    estimate(shape, N_CTX, N_UBATCH).required().div_ceil(100 * MB) * 100
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / (1024.0 * MB as f64))
}

/// Refuses with `insufficient_memory` when the model wouldn't fit in the memory available now.
pub fn check(est: &Estimate, available: u64) -> Result<(), AiError> {
    if available >= est.required() {
        return Ok(());
    }
    Err(AiError::new(
        "insufficient_memory",
        format!(
            "This model needs about {} of free memory ({} model, {} context, {} working memory, plus {} kept free \
             for the system), but only {} is available. Close some apps or choose a smaller model.",
            gb(est.required()),
            gb(est.weights),
            gb(est.kv_cache + est.recurrent),
            gb(est.compute + est.overhead),
            gb(HEADROOM),
            gb(available),
        ),
    ))
}

#[derive(Debug, Clone, Copy)]
pub struct Ram {
    pub total: u64,
    pub available: u64,
}

impl Ram {
    pub fn total_mb(&self) -> u64 {
        self.total / MB
    }

    pub fn available_mb(&self) -> u64 {
        self.available / MB
    }
}

/// Physical memory right now. Both values are 0 if the system can't be read, which makes the
/// memory check refuse to load rather than guess.
pub fn ram() -> Ram {
    match sysinfo::System::new() {
        Ok(mut sys) => {
            sys.refresh_memory();
            Ram { total: sys.total_memory(), available: sys.available_memory() }
        }
        Err(_) => Ram { total: 0, available: 0 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped like Qwen3.5-2B: 24 layers with full attention on every 4th.
    fn qwen35_2b() -> ModelShape {
        ModelShape {
            file_size: 1_280_835_840,
            n_layer: 24,
            n_embd: 2048,
            n_ff: 6144,
            n_head: 8,
            n_head_kv: 2,
            key_len: 256,
            value_len: 256,
            full_attention_interval: Some(4),
            n_vocab: 248_320,
            ssm_inner: 2048,
            ssm_state: 128,
            ssm_conv_kernel: 4,
        }
    }

    #[test]
    fn hybrid_models_only_cache_attention_layers() {
        let hybrid = estimate(&qwen35_2b(), N_CTX, N_UBATCH);
        let dense = estimate(&ModelShape { full_attention_interval: None, ..qwen35_2b() }, N_CTX, N_UBATCH);
        // 6 attention layers * 8192 positions * 2 heads * 512 values * 2 bytes.
        assert_eq!(hybrid.kv_cache, 6 * 8192 * 2 * 512 * 2);
        assert_eq!(dense.kv_cache, 4 * hybrid.kv_cache);
        assert!(hybrid.recurrent > 0 && dense.recurrent == 0);
    }

    #[test]
    fn estimate_covers_every_part_and_grows_with_context() {
        let small = estimate(&qwen35_2b(), 2048, N_UBATCH);
        let big = estimate(&qwen35_2b(), N_CTX, N_UBATCH);
        assert!(big.kv_cache > small.kv_cache);
        assert!(big.weights > qwen35_2b().file_size);
        assert!(big.compute > 0 && big.overhead > 0);
        assert_eq!(big.total(), big.weights + big.kv_cache + big.recurrent + big.compute + big.overhead);
        // More than the bare file, but not absurdly more for a 1.3 GB model.
        assert!(big.required() > big.weights + HEADROOM);
        assert!(big.required() < 4 * 1024 * MB, "{}", big.required());
    }

    #[test]
    fn check_refuses_when_memory_is_short() {
        let est = estimate(&qwen35_2b(), N_CTX, N_UBATCH);
        assert!(check(&est, est.required()).is_ok());
        assert!(check(&est, 16 * 1024 * MB).is_ok());
        let err = check(&est, est.required() - 1).unwrap_err();
        assert_eq!(err.code, "insufficient_memory");
        assert!(err.message.contains("only"), "{}", err.message);
        // A file that alone is bigger than the available memory is never attempted.
        let huge = ModelShape { file_size: 20 * 1024 * MB, ..qwen35_2b() };
        assert!(check(&estimate(&huge, N_CTX, N_UBATCH), 15 * 1024 * MB).is_err());
    }

    #[test]
    fn min_ram_is_rounded_up() {
        let mb = min_ram_mb(&qwen35_2b());
        assert_eq!(mb % 100, 0);
        assert!(mb * MB >= estimate(&qwen35_2b(), N_CTX, N_UBATCH).required());
    }

    #[test]
    fn reads_real_memory() {
        let r = ram();
        assert!(r.total > 0 && r.available > 0 && r.available <= r.total);
    }
}
