# Checklist de auditoría (antes de publicar)

Pasá esto sobre cualquier skill nueva o existente. Cada ítem mapea a una regla del estándar.

## Taxonomía (un home por tipo — ver where-things-live.md)
- [ ] Código solo en `templates/`. `references/` NO re-narra funciones/handlers/crons (sin pseudocódigo ni flow-diagrams que ecoan un template).
- [ ] Schema solo en `migrations/*.sql`, **un archivo por tabla**. Ningún DDL envuelto en `.md`.
- [ ] Carpetas por **tipo genérico** (`flows/`, `api/`). Sin carpetas por dominio (`pricing/`); eso es archivo suelto.
- [ ] Cada hoja de `references/` apunta al código (puntero), no lo reproduce.
- [ ] Una acción = una interfaz: si hay script, no hay curl equivalente en docs.

## Estructura
- [ ] `SKILL.md` es solo índice + reglas. Sin schemas, sin curls, sin pasos de deploy.
- [ ] Frontmatter: solo `name` + `description`. `description` rica en keywords + "Use when…".
- [ ] Sin campos de frontmatter no-estándar tratados como funcionales.
- [ ] Tabla de referencias del SKILL.md: < ~15-20 filas; si no, hay router intermedio.

## References / nesting
- [ ] Cada link tiene su condición ("Cargar si…").
- [ ] Cada hoja está en un router con su condición de carga (recomendado: el scan la encuentra igual, pero el router da el CUÁNDO + determinismo).
- [ ] Carpetas con varias hojas sustanciales tienen `index.md` router con "Cargar si…". Si cada item es ~1 línea, está colapsado en un solo archivo con tabla (ej. `crons.md`), no en una carpeta de hojas mínimas.
- [ ] Links relativos correctos desde la ubicación de cada archivo (verificá con el script de links).
- [ ] **Todas las referencias, no solo los links markdown.** Tras mover/renombrar un archivo, revisá también:
  - punteros a docs DENTRO del código (`// Doc: references/...`, `// ver ...`) en `templates/` y `scripts/` → quedan colgados.
  - `import` relativos de templates (`./x.ts`, `../utils/x.ts`) → que resuelvan.
- [ ] Profundidad ≤ 3 niveles.
- [ ] Cada hoja < ~150 líneas / single-topic.

## Scripts / tooling
- [ ] Cada script: `--help`, `--dry-run`, salida JSON, exit codes, secreto por env+flag, `set -euo pipefail`.
- [ ] **No hay curl runnable en markdown que duplique un script.**
- [ ] SKILL.md instruye "correr `--help`, no leer el source".
- [ ] MCP (si hay) es opcional, no dependencia dura.
- [ ] Default bash+curl+jq; `uvx/npx` solo como excepción con versión pineada.

## Cross-agent / activación
- [ ] El `description` es rico (keywords + "Use when…") — es lo que usa el agente para activar la skill desde la carpeta. NO se usa AGENTS.md para discovery de skills.
- [ ] Nada de la skill depende de auto-discovery o progressive disclosure de un runtime puntual.
- [ ] Sin symlinks, paths absolutos ni cosas OS-específicas.

## Consistencia de contenido
- [ ] Ninguna hoja muestra en full un patrón que el SKILL.md prohíbe (sin footguns copiables).
- [ ] Un dato vive en un solo lugar (sin duplicación entre hojas).

## Tokens
- [ ] Abrir la skill (SKILL.md solo) da el ~80% del contexto sin abrir hojas.
- [ ] Para una tarea típica, el agente abre 1-2 hojas, no diez.
