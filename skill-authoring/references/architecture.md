# Arquitectura: carpetas, nesting y tamaño de hojas

## El árbol

```
skills/<nombre>/
  SKILL.md          índice + reglas. ~100-130 líneas máx.
  references/       conocimiento bajo demanda (no código)
  scripts/          comandos atómicos ejecutables (.sh)
  templates/        código a copiar a la app
  migrations/       schema: un .sql por tabla, numerado por FK
  utils/            helpers compartidos (opcional)
```

## Nesting: SÍ se puede

Carpetas dentro de `references/` están permitidas y son cross-agent. Una vez que la skill está activa y el agente tiene el path, **puede listar (`ls`/`glob`/`find`) y leer cualquier archivo** — los archivos NO se pierden por no estar linkeados.

Entonces el router/`index.md` **no es para "reachability"** (el agente igual los encuentra escaneando). Sirve para:
- **Condiciones de carga** ("Cargar si…"): el filename dice QUÉ es; la condición dice CUÁNDO abrirlo, así el agente no abre lo irrelevante.
- **Determinismo + portabilidad**: no todo agente escanea proactivamente; el index garantiza que encuentre lo correcto en todos.

Distinción clave:
- **Discovery de la skill** (saber que existe / activarla) = la **carpeta de skills** (symlink del installer) + el `description`. No es AGENTS.md.
- **Navegación DENTRO de una skill activa** = el agente ya tiene filesystem completo; lista y lee lo que necesita.

✅ Correcto:
```
references/
  cron/
    index.md                 # router: tabla "Cargar si…" que linkea cada cron
    cron-cycle-end.md
    cron-cycle-cancel.md
    cron-retry-payment.md
```
Y el `SKILL.md` (o el flow) linkea a `references/cron/index.md`. El index linkea a cada hoja.

🟡 Aceptable: `cron/` con hojas bien nombradas y sin `index.md` → el agente las encuentra escaneando, pero pierde las condiciones de carga. Usalo solo si los filenames son auto-evidentes.

**Links siempre relativos a la ubicación del archivo.** Si `cron/index.md` linkea a `cron-cycle-end.md`, es ruta relativa a `cron/`. Si linkea a un schema en `references/`, es `../schema-x.md`.

## Profundidad recomendada

`SKILL.md → flow/router → hoja` (2-3 niveles). Más profundo cuesta más reads de navegación que lo que ahorra. Si necesitás más, probablemente falta consolidar.

## Tamaño de hojas = el lever de tokens REAL

Los agentes **leen el archivo entero**, no "una columna". Abrir un archivo de 500 líneas por un dato paga las 500 líneas.

- Objetivo: cada hoja **abrible para una sola tarea**. Regla práctica: **< ~150 líneas / ~1.5k tokens**.
- Si un archivo sirve a varias sub-tareas independientes → **partilo** (granularidad por flow/cron/handler).
- **Schema NO va en `references/`**: es `.sql` en `migrations/`, un archivo por tabla (ver [`where-things-live.md`](where-things-live.md)).
- **Colapsar cuando es chico**: una carpeta `cron/` con 6 hojas de ~5 líneas (solo un gotcha c/u) es peor que **un solo `crons.md` con una tabla**. Partí en carpeta cuando hay varias hojas *sustanciales*; si cada item es 1 línea, usá un archivo con tabla.

## Cuándo agregar un nivel (router) en vez de más filas

La tabla de referencias del `SKILL.md` debe quedar **escaneable: < ~15-20 filas**. Si la superás:
- No agregues más filas al `SKILL.md`.
- Agregá un **router intermedio** (ej. `references/cron/index.md`) y linkealo con una sola fila.

## Naming

- **Carpetas = tipo genérico** (`flows/`, `api/`), que recurre en cualquier skill. NO carpetas por dominio (`pricing/`) — eso va como archivo suelto (`pricing.md`).
- Nombres descriptivos del **tema**, no genéricos (`webhook-log`, no `db2`).
- El modo de falla no es "muchos archivos", es "el agente no sabe cuál abrir": nombres ambiguos o links sin condición.

## Separación de responsabilidades

Cada tipo de info tiene un solo home (código→`templates/`, comando→`scripts/`, schema→`migrations/*.sql`, conocimiento→`references/`). Detalle y la regla "references nunca re-narra código" → [`where-things-live.md`](where-things-live.md).
