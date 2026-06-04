# Escribir el SKILL.md y el frontmatter

## Qué ES el SKILL.md

El **índice + las reglas que el agente necesita CADA vez** que la skill se activa. Nada más.

## Qué va y qué NO va

| ✅ Va en SKILL.md | ❌ NO va (mandalo a una hoja) |
|---|---|
| Reglas de dominio siempre relevantes ("nunca uses X") | Schemas de DB |
| Índice de flows / references con condiciones | Curls / requests HTTP |
| Tabla de scripts disponibles (1 línea c/u) | Pasos de deploy detallados |
| Layout y named-systems del dominio | Fórmulas largas, lógica de un flow puntual |

Si el `SKILL.md` tiene un bloque de código de >10 líneas que no sea un ejemplo de invocación, probablemente va en una hoja.

## Frontmatter

```yaml
---
name: <kebab-case>
description: "<qué hace> + <cuándo usarla>. Keyword-rich."
---
```

- **`name`** y **`description`** son los únicos campos que importan cross-agent.
- **`description` es la única señal de auto-trigger** (en Claude/OpenCode). Hacela rica en keywords del dominio y con un "Use when…" explícito. Ej: *"Mercado Pago payments & subscriptions. Use when the task involves MP payment processing, webhooks, proration, recurring billing…"*.
- **No agregues** `agents:`, `metadata:`, `version:`, `tags:` como si fueran funcionales — ningún runtime los usa; son ruido muerto. (Si los querés como nota humana, que quede claro que no hacen nada.)
- **No uses** campos Anthropic-only (`allowed-tools`, `model`, `disable-model-invocation`) — no son cross-agent.

## La tabla de referencias (el corazón del patrón)

Cada fila linkea una hoja **con su condición de carga**:

```markdown
| File | Cargar si… |
|---|---|
| migrations/001_subscriptions.sql | La DB no está creada |
| references/pricing.md            | Necesitás fórmulas de proración |
```
(El ejemplo va sin links reales a propósito; en tu SKILL.md sí son links relativos.)

Sin la columna "Cargar si…", el agente no puede decidir **no** abrir el archivo → se pierde el ahorro de tokens.

## Reglas de redacción que ahorran tokens

- Reglas en bullets cortos, imperativos ("Never use `status: pending`."). No párrafos.
- Un dato, un lugar. Si la regla de cancelación está en SKILL.md, no la repitas en 3 hojas.
- El SKILL.md debe poder leerse solo y dar el 80% del contexto sin abrir nada.
