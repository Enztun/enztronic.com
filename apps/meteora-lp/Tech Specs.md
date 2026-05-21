# Technical Specification: Local AI-Driven Liquidity Provision Bot (Meteora DLMM)

(Github PAT for z-ai project REDACTED)

## 1. Project Overview

**Objective:** Deploy and customize an automated Liquidity Provider (LP) agent to manage positions on **Meteora DLMM (Solana)**. The goal is to move liquidity between bins automatically based on market volatility to maximize fee collection while minimizing Impermanent Loss.

**Primary Framework:** Meridian (Reference Repo: `[https://github.com/yunus-0x/meridian](https://github.com/yunus-0x/meridian)`)

## 2. Target Environment (The "Rig")

* **Location:** Jakarta, Indonesia (Local Execution).
* **CPU:** AMD Ryzen 3 3100.
* **GPU:** AMD Radeon RX 580 8GB (Primary target for LLM inference via VRAM).
* **Available RAM:** ~10GB dedicated for this project (Total 32GB, shared with Chrome/VS Code).
* **OS:** Windows/Linux (Docker preferred).

## 3. Tech Stack & Integration

* **Logic Layer:** Node.js (Meridian Framework).
* **Brain (LLM):** Ollama (Local) running **Llama 3.1 8B** or **Qwen 2.5 Coder 7B**.
* **Database:** PostgreSQL (via Prisma) for logging trades, performance tracking, and state management.
* **API/Backend:** Fastify (for custom monitoring endpoints).
* **Frontend:** Next.js (Dashboard for real-time bin visualization).
* **Infrastructure:** Docker (Containerized deployment).

## 4. Key Modifications Required

The AI Agent should help refactor the standard Meridian setup with the following "Pro-Dev" optimizations:

### A. Local LLM Redirection (The "Ollama" Swap)

* Standard Meridian uses OpenRouter/OpenAI.
* **Task:** Modify the `.env` and LLM service provider logic to point to `http://localhost:11434/v1`.
* **Goal:** Zero-cost inference using the RX 580 VRAM.

### B. Persistent Logging (Postgres Integration)

* The standard bot uses console logs.
* **Task:** Implement a Prisma schema to store:
* Pool selection logic (why it chose a specific pool).
* "Dry Run" performance (simulated PnL).
* Actual transaction hashes and fee collections.



### C. Resource Constraints Logic

* **Task:** Ensure the Node.js process is lightweight.
* **Goal:** Maintain a memory footprint < 1GB for the bot itself, allowing the rest of the 10GB RAM to stay free for the OS and Ollama's context window.

## 5. Instructions for the Coding Agent

1. **Analyze the Repo:** Check `[https://github.com/yunus-0x/meridian](https://github.com/yunus-0x/meridian)` (or the provided source code).
2. **Config Refactor:** Generate a `.env` template and a `user-config.json` that prioritizes local execution and Solana Mainnet (with Dry Run enabled by default).
3. **Connection Bridge:** Provide the code for a simple Fastify proxy or direct OpenAI-SDK override to ensure the bot communicates perfectly with Ollama's local endpoint.
4. **Dockerization:** Create a `docker-compose.yml` that spins up the Meridian bot, a PostgreSQL instance, and (optionally) a Next.js dashboard.
5. **Dry Run Logic:** Review the "Bin-Hopping" logic in the repo and suggest improvements for 2026 volatility levels on Solana.

## 6. Safety Protocols

* **Private Key Handling:** Do not hardcode private keys. Use `.env` with `.gitignore` or local secret management.
* **Slippage Control:** Implement strict slippage and max-position limits to protect capital during high-volatility events in Jakarta/Global markets.

---

## 7. Implementation Status

### Infrastructure & Config

| Item | Status | Notes |
|------|--------|-------|
| Ollama swap — `.env` + Fastify proxy | ✅ Done | Proxy at `deploy/fastify-ollama-proxy.js` |
| Bin-hopping V2 prompt injected into proxy | ✅ Done | Auto-injects on screener/deploy requests |
| Postgres schema — 8 Prisma models | ✅ Done | SQLite → PostgreSQL migration complete |
| Docker Compose — 5 services | ✅ Done | bot / postgres / dashboard / ollama / proxy |
| Resource limits — Docker mem caps | ✅ Done | bot ≤768MB, dashboard ≤512MB, postgres ≤256MB |
| RX 580 setup guide (ROCm / DirectML) | ✅ Done | `deploy/rx580-setup-guide.md` |
| `.gitignore` — private keys excluded | ✅ Done | `.env.meridian` not committed |

### Dashboard

| Item | Status | Notes |
|------|--------|-------|
| Dashboard UI — 8 components | ✅ Done | StatusBar, PositionCard, PnlChart, etc. |
| 6 API routes (live Prisma queries) | ✅ Done | Replaced mock data with real DB reads |
| SSE real-time stream `/api/stream` | ✅ Done | 5s DB poll → React Query invalidations |
| Prisma client singleton | ✅ Done | `src/lib/prisma.ts` |
| Config panel — POST saves to DB | ✅ Done | Upserts into `BotConfig` table |
| Authentication (next-auth) | ❌ Missing | Package installed, unconfigured — dashboard is public |
| Closed positions / trade history tab | ❌ Missing | Only open positions shown |
| Lessons viewer | ❌ Missing | `Lesson` model exists, no UI |
| Pool memory viewer (win/loss per pool) | ❌ Missing | `PoolMemory` model exists, no UI |
| Error boundary for DB-down state | ❌ Missing | Shows loading spinner indefinitely |

### Bot Integration

| Item | Status | Notes |
|------|--------|-------|
| Meridian bot code | ✅ Done | Cloned to `repos/meridian/`, Dockerfile + user-config added |
| JSON → Postgres sidecar | ✅ Done | `mini-services/sync-bot-state/` — polls /data every 5s |
| BotConfig health writer | ✅ Done | Sidecar writes bot_status, uptime, last cycle times |
| docker-compose paths fixed | ✅ Done | All build contexts correct, named volume meridian-data |
| `db:push` to running Postgres | ❌ Needs run | Run after `docker compose up -d postgres` |
| Live trading path (dryRun → false) | ❌ Not documented | Needs checklist before enabling |

---

### Immediate Next Steps (in order)

1. **Fill in your secrets** — edit `deploy/.env.meridian`:
   ```
   WALLET_PRIVATE_KEY=<your_base58_key>
   RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your_key>
   ```

2. **Start Postgres and push schema**
   ```bash
   cd deploy && docker compose up -d postgres
   cd .. && npm run db:push
   ```

3. **Pull the Ollama model** (one-time, ~5GB download)
   ```bash
   docker compose -f deploy/docker-compose.yml up -d ollama
   docker exec meridian-ollama ollama pull llama3.1:8b-instruct-q4_K_M
   ```

4. **Start everything**
   ```bash
   cd deploy && docker compose up -d
   docker compose logs -f bot sidecar
   ```
   Dashboard → http://localhost:3000

5. **Wire authentication** — add `NEXTAUTH_SECRET` + a credentials or OAuth provider to protect the dashboard

6. **Add closed positions tab** — query `Position` where `status = 'closed'`, show realized PnL

---

### How to use this:

1. **If using Google AI Studio:** Upload the `meridian` folder (after cloning it) and then paste the content above into the prompt box, asking: *"Based on this .md spec, help me refactor the attached code for local execution."*
2. **If using Qwen/z.ai:** Paste the link to the repo and this `.md` file, then ask: *"Analyze this repo and tell me exactly which files I need to modify to use local Ollama instead of OpenRouter."*

**Pro-tip:** Since you have an **RX 580**, make sure you tell the AI that you are using **ROCm** (if on Linux) or **DirectML** (if on Windows) for Ollama, as this affects how the LLM interacts with your GPU VRAM!