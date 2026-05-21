# ═══════════════════════════════════════════════════════════════
# RX 580 + Ollama Setup Guide for Meridian LP Bot
# ═══════════════════════════════════════════════════════════════

## ⚠️ The Hard Truth About RX 580 + Ollama

The AMD Radeon RX 580 (Polaris/GFX8) is a **legacy GPU** with limited
official support for modern ML workloads. Here's what you need to know:

### Performance Expectations

| Model | Quant | VRAM | Speed (RX 580) | Context Window |
|-------|-------|------|-----------------|----------------|
| Llama 3.1 8B | Q4_K_M | ~5GB | ~2-5 tok/s | 4K-8K tokens |
| Qwen 2.5 Coder 7B | Q4_K_M | ~4.5GB | ~3-6 tok/s | 4K-8K tokens |
| Llama 3.1 8B | Q8_0 | ~8GB | ~1-3 tok/s | 2K-4K tokens |
| Llama 3.2 3B | Q4_K_M | ~2GB | ~8-15 tok/s | 8K tokens |

**Recommendation:** Use **Q4_K_M quantization** — it's the best tradeoff
between quality and speed. With Meridian's ~2K token prompts, expect
15-60 seconds per agent step.

---

## Option A: Linux + ROCm (Advanced)

The RX 580 is NOT officially supported by modern ROCm. You need a workaround.

### 1. Install ROCm 5.7 (last version with Polaris support)

```bash
# Ubuntu 22.04
sudo apt-get update
wget https://repo.radeon.com/amdgpu-install/5.7/ubuntu/jammy/amdgpu-install_5.7.50700-1_all.deb
sudo apt-get install ./amdgpu-install_5.7.50700-1_all.deb
sudo amdgpu-install --usecase=rocm

# Add user to render group
sudo usermod -aG render $USER
sudo usermod -aG video $USER
```

### 2. Set the GFX override (CRITICAL for RX 580)

```bash
# Add to ~/.bashrc or /etc/environment
export HSA_OVERRIDE_GFX_VERSION=8.0.3
```

Without this, Ollama will NOT detect the RX 580 and will fall back to CPU
(which is ~10x slower).

### 3. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Verify GPU detection
HSA_OVERRIDE_GFX_VERSION=8.0.3 ollama run llama3.1:8b "Hello"
# Watch for "using AMD GPU" in the output
```

### 4. Pull the model

```bash
ollama pull llama3.1:8b-instruct-q4_K_M
```

### 5. Test with Meridian prompt

```bash
# Quick test — should respond in 10-30 seconds
HSA_OVERRIDE_GFX_VERSION=8.0.3 ollama run llama3.1:8b-instruct-q4_K_M \
  "You are an LP agent. Current position: SOL/BONK, in-range, +2.3% PnL. Action?"
```

---

## Option B: Windows + DirectML (Easier, Recommended for Jakarta)

If you're running Windows, DirectML is the simpler path and the RX 580
works out of the box.

### 1. Install Ollama for Windows

Download from: https://ollama.com/download/windows

Ollama on Windows **automatically uses DirectML** for AMD GPUs.
No special drivers or env vars needed!

### 2. Pull the model

```cmd
ollama pull llama3.1:8b-instruct-q4_K_M
```

### 3. Verify GPU usage

Open Task Manager → Performance → GPU
You should see GPU utilization spike when running inference.

### 4. Start Ollama and verify

```cmd
ollama serve
# In another terminal:
ollama run llama3.1:8b-instruct-q4_K_M "Hello, test"
```

---

## Option C: CPU-Only (Fallback, Not Recommended)

If GPU setup fails, Ollama can run on CPU:

```bash
# This will be VERY slow (~0.5-1 tok/s) but functional
OLLAMA_NUM_GPU=0 ollama run llama3.1:8b-instruct-q4_K_M "test"
```

**Warning:** CPU-only inference may be too slow for Meridian's autonomous
cycles. A single screening cycle with 20 max steps could take 10+ minutes.

---

## Memory Budget (10GB Available)

| Component | RAM | Notes |
|-----------|-----|-------|
| Ollama + model | ~6GB | VRAM offload + system RAM |
| Meridian bot | ~512MB | With NODE_OPTIONS limit |
| PostgreSQL | ~256MB | Small database |
| Next.js dashboard | ~256MB | Dev mode |
| Chrome/VS Code | ~2-3GB | Your development tools |
| **Total** | ~9-10GB | Right at the limit |

### Optimization Tips:
1. **Close Chrome tabs** when running the bot autonomously
2. **Use PM2** to run the bot (lower memory overhead than node directly)
3. **Disable HiveMind** in config to reduce network/memory overhead
4. **Use SQLite** instead of Postgres if RAM is tight (Meridian default)
5. **Reduce maxSteps** from 20 to 10-15 in user-config.json

---

## Fastify Proxy — When to Use It

The proxy is needed if you experience any of these issues:

1. **`tool_choice: "required"` errors** — Ollama doesn't support this
2. **System role rejected** — Some Ollama models reject system messages
3. **Double requests** — The bot retries due to response format issues
4. **Concurrent request crashes** — RX 580 can only handle one inference at a time

### Starting the proxy:

```bash
cd deploy
npm install fastify node-fetch
node fastify-ollama-proxy.js
```

Then update `.env`:
```
LLM_BASE_URL=http://localhost:3333/v1
```

---

## Quick Start Checklist

- [ ] Install Ollama (Windows=DirectML, Linux=ROCm+HSA_OVERRIDE)
- [ ] Pull model: `ollama pull llama3.1:8b-instruct-q4_K_M`
- [ ] Test: `ollama run llama3.1:8b-instruct-q4_K_M "hello"`
- [ ] Verify GPU usage (Task Manager on Win, `rocm-smi` on Linux)
- [ ] Copy `.env.meridian.template` to `.env` and fill in keys
- [ ] Copy `user-config.ollama.json` to `user-config.json`
- [ ] Start with `DRY_RUN=true` — verify agent cycles work
- [ ] Monitor dashboard at http://localhost:3000
- [ ] Only set `DRY_RUN=false` after 24h+ of successful dry runs

---

## Troubleshooting

### "Ollama not found"
Make sure Ollama is running: `ollama serve`

### "Out of memory"
Use a smaller model: `ollama pull llama3.2:3b-instruct-q4_K_M`
Or reduce context: set `maxTokens: 2048` in user-config.json

### "GPU not detected (Linux)"
```bash
export HSA_OVERRIDE_GFX_VERSION=8.0.3
# Verify:
rocm-smi
# Should show GPU memory usage
```

### "Too slow"
- Check GPU utilization — if 0%, you're running on CPU
- Use Q4_K_M quantization (not Q8 or FP16)
- Reduce `maxSteps` to 10
- Use the Fastify proxy to queue requests

### "Hallucinated deploys"
Local models are more prone to hallucination than cloud models.
The Fastify proxy's `tool_choice` normalization helps, but also:
- Keep `DRY_RUN=true` longer
- Set `maxSteps: 10` (fewer chances to hallucinate)
- Use `temperature: 0.2` (lower = more deterministic)
