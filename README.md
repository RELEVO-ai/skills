# RELEVO Skills

Skills compartidas del equipo RELEVO basadas en el estándar [Agent Skills](https://agentskills.io).

## Instalación

```bash
npx @relevo/skills install
```

Clona el repo a `~/.relevo/skills` y **symlinkea** cada skill a las 4 carpetas globales que escanean los agentes (cubre ~13 agentes), igual en macOS/Linux/Windows:
- `~/.agents/skills/` → Zed, OpenCode, Gemini, Amp, Cursor, Cline, Warp, Antigravity, Copilot
- `~/.claude/skills/` → Claude Code
- `~/.codex/skills/` → Codex
- `~/.config/agents/skills/` → Kimi, Amp (alt)

El discovery es **por carpeta**, no por AGENTS.md.

```bash
npx @relevo/skills install <skill-name>   # solo una skill
npx @relevo/skills sync                    # git pull + restaurar symlinks
npx @relevo/skills publish                 # git add/commit/push
npx @relevo/skills list                    # skills disponibles
```

---

## Agent Skills Protocol — Referencia

Fuente: https://agentskills.io

---

### 1. Directory Structure

```
<skill-name>/
├── SKILL.md          # REQUIRED. Metadatos (frontmatter YAML) + instrucciones (markdown).
├── scripts/          # OPTIONAL. Código ejecutable (Python, Bash, JS, etc.).
├── references/       # OPTIONAL. Documentación adicional.
├── assets/           # OPTIONAL. Templates, imágenes, data files, schemas.
└── ...               # Cualquier otro archivo o directorio.
```

- `SKILL.md` debe estar en **mayúsculas exactas**.
- El nombre del directorio **debe coincidir** con el campo `name` del frontmatter.

---

### 2. SKILL.md Format

```
---
name: <string>
description: <string>
---

<body markdown>
```

#### 2.1 Frontmatter — Protocol Standard

| Campo           | Requerido | Constraints |
|-----------------|-----------|-------------|
| `name`          | **SÍ**    | 1-64 chars. Solo lowercase alfanumérico + hífenes simples. No puede empezar/terminar con `-`. No puede tener `--`. **Debe coincidir** con el directorio padre. Regex: `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description`   | **SÍ**    | 1-1024 chars. No vacío. Describe qué hace y cuándo usarlo. |
| `license`       | No        | Nombre de licencia o archivo. |
| `compatibility` | No        | 1-500 chars. Requisitos de entorno (producto, paquetes, red, etc.). |
| `metadata`      | No        | Mapa key→value arbitrario. |
| `allowed-tools` | No        | String space-separated de herramientas pre-aprobadas. **Experimental**. |

**Reglas de `name`:**
- Solo: `a-z`, `0-9`, `-`
- Sin mayúsculas, espacios, underscores, puntos
- No empieza ni termina con `-`
- Sin `--`

**Válido:**
```yaml
name: pdf-processing
name: data-analysis
name: code-review
```

**Inválido:**
```yaml
name: PDF-Processing    # mayúscula
name: -pdf              # empieza con -
name: pdf--processing   # -- consecutivo
name: pdf_processing    # underscore
```

#### 2.2 Frontmatter — Extensiones por Agente

Campos no reconocidos por un agente son ignorados.

**Claude Code** extiende con:

| Campo | Descripción |
|-------|-------------|
| `when_to_use` | Contexto adicional de activación. Concatenado a `description`. Límite total: 1536 chars. |
| `argument-hint` | Hint para autocomplete. Ej: `[issue-number]` |
| `arguments` | Argumentos posicionales para `$name`. Space-separated o YAML list. |
| `disable-model-invocation` | `true` = solo usuario invoca. Default: `false`. |
| `user-invocable` | `false` = solo modelo invoca. Default: `true`. |
| `allowed-tools` | Tools sin pedir permiso. Space-/comma-separated o YAML list. |
| `disallowed-tools` | Tools removidas mientras el skill está activo. |
| `model` | Model override mientras el skill está activo. |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max`. |
| `context` | `fork` = ejecuta en subagente aislado. |
| `agent` | Tipo de subagente cuando `context: fork`. |
| `hooks` | Hooks scoped al skill. |
| `paths` | Glob patterns que limitan activación automática. |
| `shell` | `bash` (default) o `powershell`. |

**OpenCode** reconoce solo: `name`, `description`, `license`, `compatibility`, `metadata`. Campos extra son **ignorados**.

---

### 3. Progressive Disclosure

Los skills se cargan en 3 tiers:

| Tier | Qué se carga | Cuándo | Costo |
|------|-------------|--------|-------|
| 1. Catalog | Solo `name` + `description` | Startup | ~50-100 tokens/skill |
| 2. Instructions | Full `SKILL.md` body | Al activarse | <5000 tokens (recomendado) |
| 3. Resources | scripts/, references/, assets/ | Cuando se referencian | Varía |

20 skills instalados NO pagan 20 bodies al inicio. Solo se cargan los que se usan.

---

### 4. Discovery Paths

Cada agente decide dónde buscar. Convenciones:

| Scope | Cross-client | Cliente-específico |
|-------|-------------|-------------------|
| Project | `.agents/skills/<name>/SKILL.md` | `.<client>/skills/<name>/SKILL.md` |
| User | `~/.agents/skills/<name>/SKILL.md` | `~/.<client>/skills/<name>/SKILL.md` |

**OpenCode** busca en:
- `.opencode/skills/<name>/`
- `~/.config/opencode/skills/<name>/`
- `.claude/skills/<name>/` (compatibilidad)
- `.agents/skills/<name>/`

**Claude Code** busca en:
- `~/.claude/skills/<name>/` (personal)
- `.claude/skills/<name>/` (proyecto)
- Enterprise managed settings
- Plugins
- También escanea parents hasta el repo root

Precedencia: enterprise > personal > project.

---

### 5. Activation

**Model-driven**: el modelo decide basado en `description`.

**User-explicit**: el usuario invoca con `/skill-name`.

Control de invocación (Claude Code):

| Frontmatter | Usuario | Modelo | En catálogo |
|-------------|---------|--------|-------------|
| (default) | Sí | Sí | Description siempre visible |
| `disable-model-invocation: true` | Sí | No | Descripción oculta |
| `user-invocable: false` | No | Sí | Description siempre visible |

---

### 6. Dynamic Context Injection

Sintaxis: `` !`command` `` (inline) o `` ```! `` (multi-line block).

El comando se ejecuta **antes** de que el modelo vea el contenido. El output reemplaza el placeholder.

```markdown
## Current changes
!`git diff HEAD`

## Environment
```!
node --version
npm --version
```
```

Reglas:
- `!` debe estar al inicio de línea o después de whitespace
- Corre una sola vez — el output no se re-escanea
- No funciona en `KEY=!`cmd``
- Deshabilitable vía `"disableSkillShellExecution": true`

---

### 7. String Substitutions (Claude Code)

| Variable | Descripción |
|----------|-------------|
| `$ARGUMENTS` | Todos los argumentos pasados al invocar. |
| `$ARGUMENTS[N]` | Argumento por índice 0-based. |
| `$N` | Shorthand para `$ARGUMENTS[N]`. |
| `$name` | Argumento nombrado del frontmatter `arguments`. |
| `${CLAUDE_SESSION_ID}` | Session ID actual. |
| `${CLAUDE_EFFORT}` | Effort level actual. |
| `${CLAUDE_SKILL_DIR}` | Directorio del skill. Para paths relativos a scripts. |

---

### 8. Subagent Execution

Frontmatter: `context: fork` + opcional `agent: <type>`.

El skill corre en un subagente aislado sin acceso al historial. El body del skill es el prompt del subagente.

```yaml
---
name: deep-research
description: Research a topic thoroughly
context: fork
agent: Explore
---
```

| Agent | System prompt | CLAUDE.md |
|-------|--------------|-----------|
| `Explore` | Read-only | No carga |
| `Plan` | Planificación | No carga |
| `general-purpose` (default) | Full tools | Sí carga |

---

### 9. Scripts

Van en `scripts/`. Referencia con paths relativos al skill root.

```markdown
Run validation:
```bash
bash scripts/validate.sh "$INPUT"
```
```

**Self-contained scripts** — declarar dependencias inline:

Python (PEP 723):
```python
# /// script
# dependencies = ["beautifulsoup4"]
# ///
```

Deno: `import * as cheerio from "npm:cheerio@1.0.0"`

Bun: `import * as cheerio from "cheerio@1.0.0"` (auto-instala)

**One-off commands**: `uvx`, `pipx`, `npx`, `bunx`, `deno run`, `go run`. Pinear versiones.

**Diseño para agentes:**
- NO interactive prompts (los agentes no responden TTY)
- `--help` obligatorio
- Error messages: qué pasó, qué esperaba, qué intentar
- Structured output: JSON sobre texto libre
- stdout = datos, stderr = progreso
- Idempotencia: "create if not exists"
- `--dry-run` para operaciones destructivas
- Exit codes significativos
- Output size predecible (summary + `--offset`)

---

### 10. File References

Paths relativos al skill root. Máximo un nivel de profundidad.

```
See [reference](references/REFERENCE.md) for details.
Run: scripts/extract.py
```

---

### 11. Validación

```bash
skills-ref validate ./my-skill
```

Repo: https://github.com/agentskills/agentskills/tree/main/skills-ref

---

### 12. Cross-Agent Compatibility

| Feature | Protocol | Claude Code | OpenCode |
|---------|----------|-------------|----------|
| `name` (frontmatter) | REQUIRED | Optional (display) | REQUIRED |
| `description` | REQUIRED | Recommended | REQUIRED |
| `license` | Optional | Ignored | Optional |
| `compatibility` | Optional | Ignored | Optional |
| `metadata` | Optional | Ignored | Optional |
| `allowed-tools` | Experimental | Sí | Ignored |
| `disable-model-invocation` | No | Sí | No |
| `user-invocable` | No | Sí | No |
| `context: fork` | No | Sí | No |
| `agent` | No | Sí | No |
| `arguments` / `$ARGUMENTS` | No | Sí | No |
| Dynamic context `!`command`` | No | Sí | No |
| `${CLAUDE_SKILL_DIR}` | No | Sí | No |
| `hooks` | No | Sí | No |
| `paths` | No | Sí | No |
| `model`/`effort` | No | Sí | No |
| Discovery `.agents/skills/` | Convención | Sí | Sí |
| Discovery `.claude/skills/` | Compatibilidad | Sí | Sí |
