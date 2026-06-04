# Dónde vive cada cosa (taxonomía)

La regla que evita el 90% de los errores: **cada dato tiene UN solo home, según su TIPO.** Si la misma info está en dos lados, está mal.

## La tabla

| Tipo de info                                                                                                                               | Único home         | Granularidad                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------------- |
| Código (funciones, handlers, crons, clases)                                                                                                | `templates/*.ts`   | uno por componente                                 |
| Comando atómico contra una API                                                                                                             | `scripts/*.sh`     | uno por acción                                     |
| Schema de DB (DDL)                                                                                                                         | `migrations/*.sql` | **un archivo por tabla**, numerado por orden de FK |
| Reglas SIEMPRE relevantes ("nunca X", "cancelar 24h antes")                                                                                | `SKILL.md`         | —                                                  |
| Conocimiento de dominio que NO es código (fórmulas, gotchas, campos de respuesta de API, tablas de decisión, edge cases, routers de tarea) | `references/`      | una hoja por tema                                  |

## La regla de oro de references/

**Orienta y apunta al código. NUNCA lo re-narra.**

Si una hoja de `references/` contiene cualquiera de esto, está mal (es código disfrazado de doc):
- ❌ Pseudocódigo de una función ("1. PUT… 2. UPDATE… 3. INSERT…") → eso es el template.
- ❌ DDL envuelto en \`\`\`sql → eso es la migración `.sql`.
- ❌ Un curl runnable que ya existe como script → eso es el `.sh`.
- ❌ Un diagrama de flujo que ecoa línea por línea un template.

Lo que SÍ va en una hoja: el **gotcha / por qué** que el código no dice + un **puntero** al archivo de código. Ej: *"cancelá 24h antes porque MP cobra en cycle_end → `../templates/cron-cycle-cancel.ts`"*.

## Schema: `.sql`, no `.md`

`.md` vs `.sql` **no tiene que ver con cómo lee el agente** (lee los dos igual). El schema va en `migrations/*.sql` porque es **código ejecutable** (la fuente de verdad que crea las tablas). Un `.md` que copia el DDL es pura duplicación. **Una tabla por archivo**, numerada por orden de FK, así el agente lee solo la que necesita.

## Folders = tipo genérico, no dominio

Las carpetas son **tipos estructurales** que recurren en cualquier skill: `flows/`, `api/` (schema → `migrations/`). NO crees carpetas por **tema de dominio** (`pricing/`, `billing/`) — eso mezcla dos ejes y rompe la consistencia. El conocimiento de dominio que no mapea a un tipo va como **archivo suelto** (`pricing.md`).

## scripts vs templates (no es duplicación)

Pegan a la misma API pero sirven a **consumidores distintos**:
- `scripts/*.sh` → el **agente los corre** durante setup/test (atómicos).
- `templates/*.ts` → el **código que va a la app** del usuario (producción).

Tener la misma llamada en ambos es esperado y correcto — no es "data duplicada en docs".
