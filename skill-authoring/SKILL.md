---
name: skill-authoring
description: "Cómo escribir skills cross-agent estandarizadas (nuestro estándar). Usar al crear, auditar o refactorizar cualquier skill: estructura de carpetas, SKILL.md, references/, scripts/, migrations/, discovery por carpeta, y qué features están prohibidas por no ser cross-agent."
---

# Skill Authoring Standard

Estándar interno para escribir skills que funcionen **igual en todos los agentes** (Claude Code, Codex, Cursor, Windsurf, Gemini CLI, OpenCode, Copilot, etc.) y que **no consuman tokens de más** vía referencias bajo demanda.

## La Regla de Oro

> **Si una capacidad no la soportan TODOS los agentes objetivo, la skill no puede depender de ella.**

Todo lo Anthropic-only o runtime-específico se trata como *enhancement opcional*, nunca como requisito. Ver [`references/cross-agent-support.md`](references/cross-agent-support.md) para el detalle de qué soporta cada uno.

## Las 3 primitivas portables (lo único garantizado)

1. **Archivos markdown que el agente lista y lee** (`ls`/`glob`/`read`) **+ links relativos.** Dentro de una skill activa el agente tiene filesystem completo; la navegación funciona por esto, no por magia del runtime.
2. **Scripts bash** (`curl` + `jq`) con `--help`, `--dry-run`, salida JSON y exit codes. Cualquier agente con shell los corre.
3. **Discovery por carpeta de skills.** Cada agente escanea una carpeta (`~/.agents/skills/` y variantes por agente) y lee `<name>/SKILL.md`. El installer (`npx @relevo/skills`) **symlinkea** cada skill a esas carpetas — eso cubre ~13 agentes. **AGENTS.md NO se usa para discovery de skills.** Tu único trabajo por skill es un buen `description`. Matriz de carpetas → [`references/cross-agent-support.md`](references/cross-agent-support.md).

## Permitido vs Prohibido

| ✅ Permitido (cross-agent) | ❌ Prohibido / no depender |
|---|---|
| Markdown plano, cualquier profundidad de carpetas | Usar `AGENTS.md` como mecanismo de discovery de skills (el discovery es por carpeta) |
| Links relativos **con condición** ("Cargar si…") | Asumir carga progresiva automática del runtime |
| `scripts/*.sh` con bash + curl + jq | MCP tools como **dependencia dura** (opcional only) |
| Frontmatter `name` + `description` | Campos de frontmatter Anthropic-only como funcionales (`allowed-tools`, `model`, etc.) |
| Discovery por carpeta (`.agents/skills/` + symlink del installer) | `uvx`/`npx`/`bunx` por default |
| Hojas chicas, single-topic | Curls runnable en markdown que compiten con un script |
| `templates/` como código a copiar | Código/pseudocódigo o flow-diagrams que re-narran un template en `references/` |
| Schema en `migrations/*.sql` (uno por tabla) | DDL/SQL dentro de un `.md` |
| Folders por tipo (`flows/`, `api/`) | Carpetas por dominio (`pricing/`, `billing/`) · symlinks · paths absolutos |

## Layout canónico

```
skills/<nombre>/
  SKILL.md              # índice + reglas SIEMPRE relevantes. Nada de código/schema/curls.
  references/           # docs bajo demanda: CONOCIMIENTO, no código. Una hoja = un tema.
    flows/              # routers de tarea (entry points), con "Cargar si…"
    api/                # referencia de la API externa
    <tema>.md           # conocimiento de dominio SUELTO (no carpeta por dominio)
  scripts/*.sh          # comandos atómicos ejecutables (run, no leer)
  templates/*           # código a copiar a la app
  migrations/*.sql      # schema: UN archivo por tabla, numerado por orden de FK
```
Qué va dónde (taxonomía) → [`references/where-things-live.md`](references/where-things-live.md). Carpetas, nesting y tamaño → [`references/architecture.md`](references/architecture.md).

## Reglas siempre relevantes (no necesitás abrir references para esto)

- **Cada dato, un solo home según su TIPO.** Código→`templates/`, comando→`scripts/`, schema→`migrations/*.sql`, reglas→`SKILL.md`, conocimiento→`references/`. Si está en dos lados, está mal. (Detalle → `where-things-live.md`.)
- **references orienta y apunta al código, NUNCA lo re-narra.** Sin pseudocódigo de funciones, sin DDL en `.md`, sin curls que dupliquen un script. Una hoja lleva el *gotcha/por qué* + un puntero al archivo de código.
- **Schema = `.sql` (uno por tabla), nunca DDL en un `.md`.** El `.sql` es ejecutable y es la fuente de verdad; `.md` vs `.sql` no cambia cómo lee el agente.
- **Folders = tipo genérico** (`flows/`, `api/`), **no dominio** (`pricing/`). El dominio que no es un tipo va como archivo suelto.
- **SKILL.md es solo índice + reglas de dominio.** Si tiene un schema, un curl o pasos de deploy, está mal.
- **Cada link lleva una condición** ("Cargar si…"), así el agente decide NO abrirlo.
- **Las hojas se leen enteras** → chicas y single-topic. Ese es el lever de tokens, no el nesting.
- **Scripts: correr, no leer.** Instruí "corré `script --help`"; una acción = una interfaz.

## Flujo para crear una skill nueva

| Paso | Recurso |
|---|---|
| 1. Entender qué es y qué NO es cross-agent | [`references/cross-agent-support.md`](references/cross-agent-support.md) |
| 2. Aprender dónde vive cada cosa (taxonomía) | [`references/where-things-live.md`](references/where-things-live.md) |
| 3. Armar carpetas + decidir nesting/granularidad | [`references/architecture.md`](references/architecture.md) |
| 4. Escribir el `SKILL.md` (frontmatter + índice) | [`references/skill-md-and-frontmatter.md`](references/skill-md-and-frontmatter.md) |
| 5. Escribir scripts (o decidir MCP) | [`references/scripts-and-tooling.md`](references/scripts-and-tooling.md) |
| 6. Auditar antes de publicar | [`references/authoring-checklist.md`](references/authoring-checklist.md) |

El discovery lo da el installer (symlink a las carpetas de skills); por skill solo necesitás un buen `description`. Plantillas en [`templates/`](templates/): `SKILL.template.md`, `script.template.sh`.
