# Scripts y tooling

## Baseline: bash + curl + jq

Es lo único que corre en **todos** los agentes sin instalar nada (salvo `jq`, la única dependencia asumida — documentala).

## Contrato de un script (obligatorio)

Todo `scripts/*.sh` debe tener:

1. `--help` → uso, args requeridos/opcionales, formato de salida. (El agente descubre args por acá, **no leyendo el source**.)
2. `--dry-run` → imprime el request sin mandarlo.
3. **Salida JSON** estructurada en stdout (parseable por el agente).
4. **Exit codes**: `0` éxito, `≠0` error (con mensaje a stderr).
5. **Secretos por env var + flag**: `${MP_ACCESS_TOKEN:-}` con override `--access-token`. Nunca hardcodear.
6. `set -euo pipefail`.

Esqueleto en [`../templates/script.template.sh`](../templates/script.template.sh).

## Reglas de oro

- **Correr, no leer.** En el SKILL.md instruí: "corré `script --help` para los args; no leas el source ni reconstruyas el curl."
- **Una acción, una interfaz.** Si existe el script, **no pongas el curl equivalente en markdown**. Si hay los dos, el agente elige el curl → error y tokens de más.
- **Lo único que va en docs** sobre un endpoint con script: los **campos de respuesta** (qué devuelve), porque eso el script no lo enseña. El "cómo llamarlo" es el script.

## Scripts vs MCP tools

| Usá **script** cuando… | Usá **MCP** cuando… |
|---|---|
| Operación atómica: 1 llamada in → 1 JSON out | Workflow multi-paso con estado |
| Querés portabilidad total (cualquier shell) | Necesitás que lo llame un agente **sin shell** (browser-only) |
| `create-plan`, `get-payment`, `cancel` | Orquestación, paginación, auth handshakes, tool tipada de 1ª clase |

Para una base portable: **scripts por default, MCP como enhancement opcional**. Nunca hagas que la skill dependa de un MCP server (no todos lo tienen configurado).

## uvx / npx / bunx

Solo como **excepción documentada** cuando el script genuinamente necesita un SDK (signing complejo, paginación con tipos, retries). Si los usás:
- **Pineá la versión** (`uvx paquete@1.2.3`).
- Asumí que puede fallar offline/sandbox (bajan el paquete la 1ª vez).
- Documentá el runtime requerido.

Default = bash. No metas un runtime de Node/Python por conveniencia si curl+jq alcanza.
