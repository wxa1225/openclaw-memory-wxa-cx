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
| `workspace/HEARTBEAT.md` | Periodic check-in task list |
| `scripts/` | Lifecycle scripts (start/stop/restart) — no systemd available |
| `extensions/` | OpenClaw plugins (Miaoda coding, Guardian, team-memory-engine, Lark) |
| `skills/` | Native skills (web search, image gen, speech-to-text, etc.) |
| `team/` | Team memory engine source and data |
| `docs/` | Memory whitepaper, benchmark reports |

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

# Team memory engine tests
bash team/team-memory/run_tests.sh
```

**Note:** The environment does not have systemd. Use the shell scripts in `scripts/` rather than `openclaw gateway start/stop/restart`.

## Configuration

- **Config file:** `openclaw.json` — the single source of truth for agent settings
- **Local overrides:** `.claude/settings.local.json` — Claude Code permissions
- **Secrets:** Loaded from files via secret providers defined in `openclaw.json` (`miaoda-provider`, `miaoda-secret-provider`)
- **Models:** Multiple Chinese LLM providers configured through `miaoda` provider (GLM, Qwen, MiniMax, Kimi, Doubao)
- **Primary model:** `miaoda/doubao-seed-2.0-pro`
- **Gateway:** Local mode on port `18789`, loopback bind, token auth
- **Channel:** Feishu WebSocket, allowlist-based DM/group policy

## Architecture

### Plugin System
The agent uses a plugin-based architecture. Active plugins (in `openclaw.json.plugins.allow`):
- `openclaw-extension-miaoda` — Miaoda platform integration
- `openclaw-extension-miaoda-coding` — Coding assistant features
- `openclaw-guardian-plugin` — Safety/guardian plugin
- `team-memory-engine` — Custom team memory system (memory slot provider)
- `openclaw-lark` — Feishu/Lark integration
- `browser` — Headless browser automation (Chromium)

### Memory System
A file-based memory system in `workspace/`:
- **Daily logs:** `memory/YYYY-MM-DD.md` — raw daily notes
- **Long-term:** `MEMORY.md` — distilled knowledge, only loaded in main (1:1) sessions
- **Learnings:** `memory/learnings/` — ERRORS.md, LEARNINGS.md, FEATURE_REQUESTS.md
- **Team memory engine:** `team/` directory — versioned ledger with decay/risk model

### Agent Startup Sequence
On each wake, the agent reads (in order): `SOUL.md` → `USER.md` → today/yesterday's memory logs → `MEMORY.md` (main session only). If `BOOTSTRAP.md` exists, follow it then delete it.

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
