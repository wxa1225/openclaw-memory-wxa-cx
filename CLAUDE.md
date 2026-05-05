# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **OpenClaw agent** project (`miaoda-openclaw` v2.7.1) — an AI assistant that lives in Feishu (Lark). It is built on the OpenClaw agent framework (engine version `2026.4.11`) and hosted on a Miaoda cloud machine. The agent communicates via Feishu WebSocket, uses multiple LLM providers through a unified API gateway, and implements a custom team memory system for long-term collaboration.

## Key Directories

| Path | Purpose |
|------|---------|
| `openclaw.json` | Main configuration — models, channels, plugins, tools, secrets |
| `workspace/` | Agent workspace — identity, soul, memory, heartbeat files |
| `workspace/SOUL.md` | Agent personality, behavioral guidelines, safety rules |
| `workspace/AGENTS.md` | Operational playbook — startup sequence, memory system, Feishu permissions |
| `workspace/IDENTITY.md` | Agent identity (name, style, avatar) |
| `workspace/USER.md` | User profile |
| `workspace/MEMORY.md` | Long-term memory (persistent across sessions) |
| `workspace/TOOLS.md` | Per-environment tool configuration (local, not shared with skills) |
| `workspace/HEARTBEAT.md` | Periodic check-in task list (currently empty/disabled) |
| `workspace/BOOTSTRAP.md` | Onboarding script — still exists, bootstrap flow not yet completed |
| `scripts/` | Lifecycle scripts (start/stop/restart) — no systemd available |
| `extensions/` | OpenClaw plugins (Miaoda coding, Guardian, team-memory-engine, Lark, mem0) |
| `skills/` | Native skills (8 skills: web search, image gen, speech-to-text, doc parsing, etc.) |
| `team/` | Team memory engine source and data |
| `docs/` | Memory whitepaper (`memory-whitepaper.md`), benchmark report (`benchmark-report.md`) |
| `agents/` | Runtime agent state — `agents/main/agent/models.json` has model configs including codex provider |
| `canvas/` | Browser-based visualization UI (`canvas/index.html`) |
| `completions/` | Shell autocompletion scripts for `openclaw` CLI (bash, zsh, fish, PowerShell) |
| `identity/` | Device identity and auth credentials (`device.json`, `device-auth.json`) |
| `cron/` | Cron job definitions (`cron/jobs.json`) |
| `tasks/` | Task run history persisted in SQLite (`tasks/runs.sqlite`) |
| `devices/` | Device pairing state (`paired.json`, `pending.json`) |
| `delivery-queue/` | Message delivery retry queue (has `failed/` subdirectory) |

### Additional Directories

- `.claude/settings.local.json` — Claude Code permissions allowlist (Bash, Read, Git, npm)
- `workspace/.openclaw-guardian/skill-detect-state.json` — Guardian plugin runtime state
- `workspace/.openclaw/workspace-state.json` — Workspace bootstrap state
- `update-check.json` — Last update check timestamp
- `.npmrc` — npm registry points to Chinese mirror (`npmmirror.com`), global prefix `/home/gem/.npm-global`
- `.spark_project` — Spark CLI config for Miaoda Spark platform deployment

## Development Commands

```bash
# Start the agent
npm start          # runs scripts/start.sh
# or directly:
nohup openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &

# Restart
npm restart        # runs scripts/restart.sh

# Stop
npm stop           # runs scripts/stop.sh

# Onboard (non-interactive)
npm run onboard    # openclaw onboard --non-interactive --accept-risk

# Lint (noop)
npm run lint

# Tests
bash team/team-memory/run_tests.sh          # team memory engine (Jest)
cd team-memory-engine && npm test            # team memory engine via Jest
cd extensions/openclaw-lark && npx vitest    # Lark plugin tests (vitest)
cd extensions/openclaw-mem0-plugin && npx vitest  # mem0 plugin unit/integration tests
```

**Note:** The environment does not have systemd. Use the shell scripts in `scripts/` rather than `openclaw gateway start/stop/restart`.

## Configuration

- **Config file:** `openclaw.json` — the single source of truth for agent settings
- **Local overrides:** `.claude/settings.local.json` — Claude Code permissions
- **Secrets:** Loaded from files via secret providers defined in `openclaw.json` (`miaoda-provider`, `miaoda-secret-provider`)
- **Models:** Multiple Chinese LLM providers configured through `miaoda` provider (GLM, Qwen, MiniMax, Kimi, Doubao)
- **Primary model:** `miaoda/doubao-seed-2.0-pro`
- **Secondary model:** `codex` provider (OpenAI) configured in `agents/main/agent/models.json` with GPT-5.4, GPT-5.4-mini, GPT-5.2
- **Gateway:** Local mode on port `18789`, loopback bind, token auth. `dangerouslyDisableDeviceAuth: true`, allowed origins include Miaoda Feishu domain and internal `aiforce.run` URLs
- **Channel:** Feishu WebSocket, allowlist-based DM/group policy
- **Sessions:** `session.dmScope: "per-channel-peer"` — DM sessions scoped per channel peer
- **Message ack:** `messages.ackReactionScope: "group-mentions"` — ack reactions only in groups when mentioned

## Architecture

### Plugin System
The agent uses a plugin-based architecture. Active plugins (in `openclaw.json.plugins.allow`):
- `openclaw-extension-miaoda` — Miaoda platform integration (npm, v1.0.14)
- `openclaw-extension-miaoda-coding` — Coding assistant features (npm, v1.0.15)
- `openclaw-guardian-plugin` — Safety/guardian plugin (npm, v2026.4.19)
- `team-memory-engine` — Custom team memory system, memory slot provider (local, v0.2.0, config: `teamId: "openclaw-team"`, `decayCheckInterval: 1800000`)
- `openclaw-lark` — Feishu/Lark integration (tgz archive, v2026.4.8)
- `browser` — Headless browser automation (Chromium)

Inactive plugins:
- `openclaw-mem0-plugin` — Installed but disabled (npm, v1.1.2, has unit + integration tests)

### Skills System
- **Root skills** (`skills/`): 8 native skills — `miaoda-doc-parse`, `miaoda-image-understanding`, `miaoda-openclaw-guide`, `miaoda-skillhub`, `miaoda-speech-to-text`, `miaoda-text-gen-image`, `miaoda-web-fetch`, `miaoda-web-search`
- **Lark skills** (`extensions/openclaw-lark/skills/`): 9 Feishu-specific skills — bitable, calendar, channel-rules, create-doc, fetch-doc, im-read, task, troubleshoot, update-doc
- **Coding skills** (`extensions/openclaw-extension-miaoda-coding/skills/`): 2 skills — miaoda-coding, miaoda-database-skill

### Memory System
A file-based memory system in `workspace/`:
- **Daily logs:** `memory/YYYY-MM-DD.md` — raw daily notes
- **Long-term:** `MEMORY.md` — distilled knowledge, only loaded in main (1:1) sessions
- **Learnings:** `memory/learnings/` — ERRORS.md, LEARNINGS.md, FEATURE_REQUESTS.md
- **Team memory engine:** `team/` directory — versioned ledger with decay/risk model

### Agent Startup Sequence
On each wake, the agent reads (in order): `SOUL.md` → `USER.md` → today/yesterday's memory logs → `MEMORY.md` (main session only). If `BOOTSTRAP.md` exists, follow it then delete it.

### Heartbeat
Configured in `openclaw.json` to run every 4 hours during 08:00-22:00 using `miaoda/miaoda-model-flash` model. Currently disabled (HEARTBEAT.md is empty/commented out).

### Feishu Integration
- Primary communication channel via WebSocket
- Owner Open ID: `ou_23ab1a1db6759ee9ae44a8e441a52153`
- Available APIs: IM, CCM (docs), Base (tables), Contact, Search, Calendar, Auth
- Disabled tools: Task, some Base/CCM tools (see `openclaw.json` `tools.deny`)
- Strict permission model: owner vs non-owner vs group chat contexts

## Important Conventions

- The agent is designed to be autonomous within safety boundaries. It reads files proactively before acting.
- Destructive operations require user confirmation.
- Secrets are never output, even to the owner in DM.
- Group chat behavior is conservative — only speak when providing value.
- Memory is file-based: "write it down, don't keep it in your head" — data not in files is lost on restart.

## Git Conventions

`.gitignore` excludes: browser user-data, cache, `.agent/`, `.state/`, and log files — these are considered ephemeral.
