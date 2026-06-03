# RELEVO Skills

Skills compartidas del equipo RELEVO — instalables en OpenCode, Claude Code, Codex, Cursor y cualquier agente compatible.

## Instalar

```bash
npx @relevo/skills install payments-mercadopago
```

Para que el agente lo descubra, se crea un symlink:

```
~/.config/opencode/skills/payments-mercadopago/  →  ~/.relevo/skills/payments-mercadopago/
~/.claude/skills/payments-mercadopago/            →  ~/.relevo/skills/payments-mercadopago/
```

## Sincronizar

```bash
npx @relevo/skills sync
```

## Publicar cambios

```bash
npx @relevo/skills publish
```

## Skills

| Skill | Version | Description |
|---|---|---|
| payments-mercadopago | 1.0.0 | Mercado Pago payments & subscriptions |

## Estructura

```
payments-mercadopago/       ← nombre plano, compatible con OpenCode
  SKILL.md                  ← frontmatter + domain rules
  AGENTS.md                 ← quick-reference rules
  migrations/
  references/
  templates/
  utils/
cli/                        ← @relevo/skills CLI
skills.json                 ← registro de skills disponibles
```
