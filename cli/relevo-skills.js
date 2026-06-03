#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SKILLS_REPO = path.resolve(process.env.HOME, '.relevo/skills');
const AGENTS = {
  opencode: path.resolve(process.env.HOME, '.config/opencode/skills'),
  'claude-code': path.resolve(process.env.HOME, '.claude/skills'),
  codex: path.resolve(process.env.HOME, '.codex/skills'),
  cursor: path.resolve(process.env.HOME, '.cursor/skills'),
};

function getSkills() {
  const dirs = fs.readdirSync(SKILLS_REPO, { withFileTypes: true });
  return dirs.filter(d => d.isDirectory() && d.name !== '.git' && d.name !== 'cli' && d.name !== '.github')
             .map(d => d.name);
}

function install(name, agents) {
  const source = path.join(SKILLS_REPO, name);
  if (!fs.existsSync(source)) {
    console.error(`Skill "${name}" not found in ${SKILLS_REPO}`);
    process.exit(1);
  }

  const targets = agents || Object.keys(AGENTS);
  for (const agent of targets) {
    const dir = AGENTS[agent];
    if (!dir) { console.warn(`Unknown agent: ${agent}`); continue; }

    const link = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const s = fs.lstatSync(link);
      if (s.isSymbolicLink() || s.isDirectory()) fs.rmSync(link, { recursive: true, force: true });
    } catch {}
    fs.symlinkSync(source, link);
    console.log(`  + ${agent}/${name}`);
  }
}

function sync() {
  execSync('git pull --ff-only', { cwd: SKILLS_REPO, stdio: 'inherit' });

  for (const name of getSkills()) {
    const source = path.join(SKILLS_REPO, name);
    for (const [agent, dir] of Object.entries(AGENTS)) {
      const link = path.join(dir, name);
      try {
        const s = fs.lstatSync(link);
        if (!s.isSymbolicLink()) continue;
        if (fs.readlinkSync(link) !== source) continue;
      } catch {
        fs.mkdirSync(dir, { recursive: true });
        fs.symlinkSync(source, link);
        console.log(`  + ${agent}/${name} (restored)`);
      }
    }
  }
}

function publish() {
  execSync('git add . && git commit || true', { cwd: SKILLS_REPO, stdio: 'inherit' });
  execSync('git push', { cwd: SKILLS_REPO, stdio: 'inherit' });
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case 'install':
    if (!args[0]) { console.error('Usage: relevo-skills install <name> [agent...]'); process.exit(1); }
    install(args[0], args.slice(1));
    break;
  case 'sync':
    sync();
    break;
  case 'publish':
    publish();
    break;
  case 'list':
    console.log(getSkills().join('\n'));
    break;
  default:
    console.log('Commands: install <name> [agent...], sync, publish, list');
}
