# RELEVO Skills

Agent skills for the RELEVO SaaS Factory — reusable, versioned knowledge modules for Claude Code, OpenCode, Codex, Cursor, and any agent that supports the skills convention.

## Install

```bash
npx skills add RELEVO-ai/skills
```

Choose which skills to install. Each skill gets loaded into your agent automatically.

## Catalog

### Payments

| Skill | Description | Version |
|---|---|---|
| [mercadopago](skills/payments/mercadopago/SKILL.md) | Payments & subscriptions with Mercado Pago. Webhook validation, subscription lifecycle, proration, recurring billing. | 1.0.0 |

### Tooling

| Skill | Description | Version |
|---|---|---|
| *(coming soon)* | | |

### Notifications

| Skill | Description | Version |
|---|---|---|
| *(coming soon)* | | |

## Skill Structure

Each skill follows this layout:

```
skills/<category>/<name>/
  SKILL.md        ← loaded by agent — domain rules, architecture, deployment
  AGENTS.md       ← agent-specific quick-reference (rules in imperative form)
  migrations/     ← SQL migrations (run once per project)
  references/     ← detailed reference docs (API, schema, flows)
  templates/      ← copy-paste code templates
  utils/          ← shared utilities
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Nesting & Discovery

Skills live in `skills/<category>/<name>/` for human browsability on GitHub. Agent installers use `skills.json` at the root to map skill names to paths — so `mercadopago` resolves to `skills/payments/mercadopago/SKILL.md` without the installer needing to walk the tree.

To add a new skill, add its entry to `skills.json` and open a PR.
