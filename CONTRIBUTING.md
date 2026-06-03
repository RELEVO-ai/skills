# Contributing a Skill

## Before you start

Check `skills.json` — if a skill for your use case already exists, improve it instead of creating a new one.

## Skill requirements

Every skill must have:

- `SKILL.md` with valid frontmatter (`name`, `category`, `description`, `version`, `agents`, `tags`)
- `AGENTS.md` with imperative quick-reference rules (what the agent should DO, not explain)
- An entry in `skills.json`

## Frontmatter schema

```yaml
---
name: skill-name            # kebab-case, matches folder name
category: payments          # payments | notifications | tooling | auth | infra
description: "..."          # one sentence, starts with action verb
version: "1.0.0"            # semver
agents: [...]               # which agents this was tested on
tags: [...]                 # for discovery
---
```

## Folder structure

```
skills/<category>/<name>/
  SKILL.md          required
  AGENTS.md         required
  migrations/       SQL files, numbered: 001_..., 002_...
  references/       Detailed docs (api, schema, flows)
  templates/        Copy-paste code, named by what they do
  utils/            Shared helpers
```

## Versioning

- Patch (`1.0.x`): fix a rule, add a reference doc, update a template
- Minor (`1.x.0`): new template, new reference, new cron/handler
- Major (`x.0.0`): breaking change to schema, renamed systems, incompatible migration

Update the version in both `SKILL.md` frontmatter and `skills.json`.

## PR checklist

- [ ] New folder under `skills/<category>/<name>/`
- [ ] `SKILL.md` has valid frontmatter
- [ ] `AGENTS.md` has imperative rules (not explanations)
- [ ] Entry added to `skills.json`
- [ ] README catalog updated
- [ ] Version bumped if modifying an existing skill

## Review

PRs are reviewed by the skill owner (see `CODEOWNERS`). New skills require review from a RELEVO senior engineer.
