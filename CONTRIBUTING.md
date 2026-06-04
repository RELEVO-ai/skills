# Contributing a Skill

Seguí el estándar interno: **`skill-authoring/SKILL.md`** (cross-agent, token-eficiente). Esto es el resumen operativo.

## Requisitos de una skill

- `SKILL.md` con frontmatter **`name` + `description`** — lo único requerido y cross-agent. `description` rica en keywords + "Use when…": es lo que usa el agente para activar la skill.
- Carpeta al **top-level del repo**, con nombre = `name` (kebab-case). **NO** `skills/<category>/...`.
- Contenido según la taxonomía (un home por tipo): código→`templates/`, comando atómico→`scripts/*.sh`, schema→`migrations/*.sql` (un archivo por tabla, numerado por FK), conocimiento→`references/`.
- **NO** crear un `AGENTS.md` por skill. El discovery es por carpeta: el installer symlinkea tu skill a las carpetas de skills de los agentes.

## Layout

```
<name>/
  SKILL.md          required (name + description)
  references/       conocimiento (flows/, api/, *.md) — NUNCA código
  scripts/          comandos atómicos .sh (--help, --dry-run, JSON, exit codes)
  templates/        código a copiar a la app
  migrations/       schema: un .sql por tabla, numerado por FK
  utils/            helpers (opcional)
```

## PR checklist

- [ ] Carpeta al top-level, nombre = `name`
- [ ] Frontmatter `name` + `description` válidos (description con keywords + "Use when…")
- [ ] Taxonomía respetada: sin código/DDL narrado en `references/`, sin curls que dupliquen scripts
- [ ] Referencias resueltas: links `.md` + `// Doc:` en templates/scripts + `import` relativos
- [ ] README catalog actualizado si corresponde

## Review

PRs revisados por el owner del área (ver `CODEOWNERS`). Skills nuevas requieren review de un senior de RELEVO.
