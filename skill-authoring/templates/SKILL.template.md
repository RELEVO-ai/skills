---
name: <kebab-case-name>
description: "<Qué hace la skill> + Use when <disparadores con keywords del dominio>."
---

# <Nombre> Skill

<Una frase: qué resuelve.>

## Domain Rules (siempre relevantes)

- <Regla imperativa corta. Ej: "Never use X directly — causa Y.">
- <Regla. Un dato, un lugar.>

## Named Systems (opcional — entry points del dominio)

| System | Type | Responsibility |
|---|---|---|
| `<sistema>` | <Edge Fn / Cron / Handler> | <qué hace> |

## Reference Documents (cargar bajo demanda)

Reemplazá los placeholders. Recordá: schema → `migrations/*.sql` (uno por tabla), NO en references.

| File | Cargar si… |
|---|---|
| references/flows/<task>.md      | <condición de la tarea> |
| references/<tema>.md            | <conocimiento de dominio> |
| migrations/00X_<tabla>.sql      | La DB / esa tabla no está creada |

## Scripts (correr, no leer — usá `--help`)

| Script | Acción |
|---|---|
| `scripts/<accion>.sh` | <qué hace> |

Todos soportan `--help` y `--dry-run`. Secreto vía `$<ENV_VAR>` o `--<flag>`.

## Templates

| File | Content |
|---|---|
| `templates/<x>.ts` | <qué es> |
