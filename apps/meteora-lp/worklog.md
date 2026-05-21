# Worklog — Meridian LP Private Project
# All agents working on this project MUST append their entries below

---
Task ID: 1
Agent: Z.ai Main
Task: Build Meridian DLMM LP Dashboard + Infrastructure

Work Log:
- Read and analyzed Tech Specs (upload/Tech Specs.md)
- Cloned Meridian repo from GitHub (repos/meridian)
- Deep-dived into: agent.js, config.js, prompt.js, dlmm.js, executor.js, definitions.js, CLAUDE.md
- Identified 3 gaps in original analysis: Fastify proxy, ROCm/DirectML, concrete Postgres schema
- Created GitHub repo: Enztun/meteora-lp-private (private)
- Configured git remote with authentication

Deliverables:
1. **Prisma Schema** (prisma/schema.prisma) — 8 models: Position, DecisionLog, TransactionLog, DryRunResult, PoolCandidate, BotConfig, Lesson, PoolMemory, ThresholdSnapshot
2. **Dashboard UI** (src/components/dashboard/) — 8 components: status-bar, position-card, bin-range-visualizer, pnl-chart, decision-log, pool-candidates, config-panel, setup-guide
3. **API Routes** (src/app/api/) — 6 endpoints: /api/positions, /api/pnl, /api/config, /api/decisions, /api/candidates, /api/health
4. **Main Page** (src/app/page.tsx) — Full dashboard with tabbed interface
5. **Types + Mock Data** (src/lib/) — meridian-types.ts, mock-data.ts, dashboard-store.ts
6. **Config Files** (deploy/) — .env.meridian.template, user-config.ollama.json
7. **Fastify Proxy** (deploy/fastify-ollama-proxy.js) — Ollama compatibility layer with request queuing
8. **Docker Compose** (deploy/docker-compose.yml) — bot + Postgres + Next.js + Ollama + proxy
9. **Dockerfiles** (deploy/) — Dockerfile.meridian, Dockerfile.proxy, Dockerfile.dashboard
10. **Bin-Hopping V2** (deploy/bin-hopping-v2.js) — Adaptive range algorithm with tiers, mean-reversion, momentum, fee-aware
11. **RX 580 Setup Guide** (deploy/rx580-setup-guide.md) — ROCm/DirectML/Windows/Linux instructions

Stage Summary:
- All Tech Spec requirements addressed (Section A: Ollama swap, Section B: Postgres, Section C: Resource constraints)
- Safety protocols maintained (private keys in .env only, slippage controls documented)
- Dashboard running at localhost:3000 with mock data
- All code passes lint check
- Ready for GitHub push

---
Task ID: 2
Agent: Claude Sonnet 4.6
Task: Connect live data, real-time stream, PostgreSQL migration, bin-hopping V2 wiring

Work Log:
- Pulled code from GitHub (Enztun/meteora-lp-private) into existing local folder
- Reviewed full codebase — identified 4 pending next steps from prior session
- Installed npm dependencies (node_modules was absent after pull)

Deliverables:
1. **PostgreSQL migration** (prisma/schema.prisma + .env)
   - Changed Prisma provider from `sqlite` → `postgresql`
   - Updated DATABASE_URL to match docker-compose credentials:
     `postgresql://meridian:meridian_secret@localhost:5432/meridian?schema=public`
   - Ran `prisma generate` to regenerate client for new provider

2. **Prisma singleton** (src/lib/prisma.ts)
   - Dev-safe global instance pattern (no hot-reload connection leaks)

3. **Live API routes** — all 6 routes replaced mock data with Prisma queries:
   - `/api/health` — reads `BotConfig` keys + aggregates open position count/SOL
   - `/api/positions` — `Position` model (open only) with full DB→type mapping
   - `/api/decisions` — `DecisionLog` 50 most recent, JSON fields parsed
   - `/api/candidates` — `PoolCandidate` sorted by score, ranked
   - `/api/pnl` — cumulative from closed positions + fee claim transactions, sorted by date
   - `/api/config` — GET reads key/value store, POST upserts individual keys with section tagging

4. **SSE real-time stream** (src/app/api/stream/route.ts + src/lib/use-live-data.ts)
   - `/api/stream` polls DB every 5s, emits named events:
     `positions_changed`, `decision_added`, `candidates_changed`
   - `useLiveData()` hook connects EventSource → React Query invalidations
   - Hook mounted in DashboardContent — effective refresh latency: 5s vs previous 30s
   - No extra packages, no custom server — works with Next.js App Router natively

5. **Bin-hopping V2 injection** (deploy/fastify-ollama-proxy.js)
   - Added `injectBinHoppingPrompt()` that detects screener/deploy requests
     by keywords: `bins_below`, `deploy_position`, `bin_step`, `screener`, etc.
   - Appends V2 tier+mode guidance to the system message automatically
   - Injected inside `normalizeRequestBody` — runs on every proxied LLM call

6. **Bug fixes**
   - `src/components/dashboard/config-panel.tsx` — added `step?: number` to `ConfigField` interface
   - `src/components/dashboard/decision-log.tsx` — changed to `import type` to fix isolatedModules conflict

Known gaps (see Tech Specs.md §7 for full checklist):
- `repos/meridian/` is empty — bot not yet cloned
- `mini-services/` is empty — no JSON→DB sidecar yet
- `BotConfig` health keys have no writer process
- `next-auth` unconfigured — dashboard has no authentication
- No closed positions UI, no Lessons viewer, no PoolMemory viewer

---
Task ID: 3
Agent: Claude Sonnet 4.6
Task: Full system integration — make docker compose up actually work end-to-end

Work Log:
- Audited entire project: found 3 critical blockers (missing bot code, wrong docker-compose paths, no sidecar)
- Cloned Meridian bot from https://github.com/yunus-0x/meridian into repos/meridian/
- Read Meridian source (state.js, decision-log.js, lessons.js, pool-memory.js, config.js) to understand exact JSON schemas the bot writes
- Identified that Meridian writes JSON to process.cwd(), so running it with `cd /data && node /app/index.js` cleanly separates data from code

Deliverables:
1. **repos/meridian/Dockerfile**
   - Multi-stage (builder + slim runtime)
   - CMD: `cd /data && exec node /app/index.js` so all JSON files land in /data (named volume)
   - NODE_OPTIONS=--max-old-space-size=512, health check included

2. **repos/meridian/user-config.json**
   - Points LLM to Fastify proxy at `http://proxy:3333/v1` (the docker network hostname)
   - Model: llama3.1:8b-instruct-q4_K_M (fits RX 580 VRAM)
   - maxTokens: 2048, maxSteps: 15 (conservative for local LLM)
   - DRY_RUN: true, all defaults matching Meridian config schema exactly

3. **mini-services/sync-bot-state/index.js** — Full sidecar bridge:
   - Polls DATA_DIR (named volume) every 5s
   - syncPositions() — state.json → Position model (upsert by positionAddress)
   - syncDecisions() — decision-log.json → DecisionLog (upsert by id, skips seen IDs)
   - syncLessons() — lessons.json → Lesson (findUnique then create, SHA1 stable ID for lessons without IDs)
   - syncPoolMemory() — pool-memory.json → PoolMemory (upsert by poolAddress, derives win/loss/totals from deploys array)
   - updateHealth() — writes bot_status, uptime, last_screening_cycle, last_management_cycle to BotConfig (health is 'online' if state updated < 2min ago, 'degraded' < 10min, 'offline' after)
   - DB retry loop (20 attempts × 3s) so sidecar starts gracefully before Postgres is ready

4. **mini-services/sync-bot-state/package.json** — ESM module, @prisma/client dep
5. **mini-services/sync-bot-state/Dockerfile**
   - Build context = project root (for access to prisma/schema.prisma)
   - Copies prisma/, runs `prisma generate`, then copies index.js

6. **deploy/docker-compose.yml** — Complete rewrite with correct paths:
   - bot: context ../repos/meridian, dockerfile Dockerfile (inside repo)
   - dashboard: context .. (project root), dockerfile deploy/Dockerfile.dashboard
   - sidecar: context .. (project root), dockerfile mini-services/sync-bot-state/Dockerfile
   - proxy: context . (deploy/), dockerfile Dockerfile.proxy
   - Named volume `meridian-data` shared between bot (rw) and sidecar (ro)
   - All services on meridian-net bridge network

7. **deploy/Dockerfile.dashboard** — Fixed:
   - Switched from `npm ci` (requires lock file) to `npm install`
   - Added explicit `npx prisma generate` step after copying prisma/ (fixes client missing in standalone build)

8. **deploy/.env.meridian** — Safe placeholder (gitignored):
   - Documents all required vars (WALLET_PRIVATE_KEY, RPC_URL, LLM_BASE_URL, LLM_API_KEY)
   - DRY_RUN=true by default

System startup order after this commit:
1. Fill in deploy/.env.meridian (wallet key + RPC URL)
2. Pull Ollama model: `docker exec meridian-ollama ollama pull llama3.1:8b-instruct-q4_K_M`
3. cd deploy && docker compose up -d postgres
4. cd .. && npm run db:push
5. docker compose up -d
