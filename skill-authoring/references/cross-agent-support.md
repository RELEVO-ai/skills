# Cross-Agent Support (qué es portable + dónde se instalan las skills)

Foto a junio 2026, con research de dónde descubre skills cada agente.

## Discovery de skills = carpeta de skills (NO AGENTS.md)

Todos los agentes objetivo descubren skills escaneando una **carpeta de skills** (cada `<name>/SKILL.md`). El installer (`npx @relevo/skills`) **symlinkea** cada skill ahí. **AGENTS.md NO es el mecanismo de discovery de skills** — es otra cosa (instrucciones generales del repo) y el installer de skills no lo toca.

### Los 4 targets globales que cubren ~13 agentes

| Target (macOS/Linux) | Windows | Cubre |
|---|---|---|
| `~/.agents/skills/` | `%USERPROFILE%\.agents\skills\` | Zed, OpenCode, Gemini CLI, Amp, Cursor, Cline, Warp, Antigravity, Copilot |
| `~/.claude/skills/` | `%USERPROFILE%\.claude\skills\` | Claude Code |
| `~/.codex/skills/` | `%USERPROFILE%\.codex\skills\` | Codex |
| `~/.config/agents/skills/` | `%USERPROFILE%\.config\agents\skills\` | Kimi Code CLI, Amp (alt) |

- `~` → `%USERPROFILE%` en Windows (`os.homedir()` + `path.join` lo resuelve). En Windows el symlink de carpeta usa `junction` (no pide admin).
- A nivel **proyecto**, `.agents/skills/` en el root del repo es el target casi universal.
- N/A: **ChatGPT** (no tiene carpeta local de skills). Caso aparte: **Deep Agents** usa `~/.deepagents/<assistant_id>/skills/` (per-assistant).

## Lo que es universal (podés depender de esto)

| Capacidad | Por qué |
|---|---|
| Leer/listar markdown en cualquier carpeta (`ls`/`glob`/`read`) | toda tool agente tiene file-read |
| Seguir links relativos | es lectura de archivos, no runtime |
| Carpeta de skills (`.agents/skills/` + per-agent) | confirmado en ~13 agentes |
| `scripts/*.sh` (bash + curl + jq) | cualquier agente con shell |
| Frontmatter `name` + `description` | en el peor caso se ignora sin romper |

## Lo que NO es universal (nunca depender)

| Feature | Quién lo tiene | Regla |
|---|---|---|
| Progressive disclosure automática | Claude/OpenCode (otros parcial) | diseñá para que el costo lo controle el LINK, no el runtime |
| Campos frontmatter `allowed-tools`, `model`, `context: fork` | Claude-only | no usarlos como funcionales |
| MCP tools | solo si el agente tiene el server | enhancement opcional, nunca dependencia dura |
| `uvx`/`npx`/`bunx` auto-install | requiere runtime + red | bash baseline; excepción con versión pineada |

## AGENTS.md ≠ discovery de skills

`AGENTS.md` existe (estándar Linux Foundation, **instrucciones generales** del repo) pero **no es donde se cargan las skills**. No metas el catálogo de skills ahí ni lo toques desde el installer — el discovery ya lo da la carpeta + symlink.

## Fuentes
- Claude Code — https://code.claude.com/docs/en/skills
- OpenCode — https://opencode.ai/docs/skills/
- Gemini CLI — https://geminicli.com/docs/cli/skills/
- Zed — https://zed.dev/docs/ai/skills
- Codex — https://developers.openai.com/codex/skills
- Cursor — https://cursor.com/docs/skills
- Amp — https://ampcode.com/manual
- Cline — https://docs.cline.bot/features/skills
- Warp — https://docs.warp.dev/agent-platform/capabilities/skills/
- GitHub Copilot — https://cli.github.com/manual/gh_skill_install
