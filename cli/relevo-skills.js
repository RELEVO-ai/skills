#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_URL_SSH = 'git@github.com:RELEVO-ai/skills.git';
const REPO_URL_HTTPS = 'https://github.com/RELEVO-ai/skills.git';
const SKILLS_REPO = path.resolve(process.env.HOME, '.relevo/skills');
const AGENTS = {
  opencode: path.resolve(process.env.HOME, '.config/opencode/skills'),
  'claude-code': path.resolve(process.env.HOME, '.claude/skills'),
  codex: path.resolve(process.env.HOME, '.codex/skills'),
  cursor: path.resolve(process.env.HOME, '.cursor/skills'),
};

function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: 'inherit', ...opts });
  } catch {}

}

function cloneRepo() {
  console.log('Cloning RELEVO-ai/skills...');
  try {
    execSync(`git clone ${REPO_URL_SSH} '${SKILLS_REPO}'`, { stdio: 'inherit' });
  } catch {
    console.log('SSH failed, trying gh CLI...');
    try {
      execSync(`gh repo clone RELEVO-ai/skills '${SKILLS_REPO}'`, { stdio: 'inherit' });
    } catch {
      console.log('gh CLI failed, trying HTTPS...');
      execSync(`git clone ${REPO_URL_HTTPS} '${SKILLS_REPO}'`, { stdio: 'inherit' });
    }
  }
}

function ensureRepo() {
  if (!fs.existsSync(path.join(SKILLS_REPO, '.git'))) cloneRepo();
}

function getSkills() {
  const dirs = fs.readdirSync(SKILLS_REPO, { withFileTypes: true });
  return dirs.filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'cli')
             .map(d => d.name);
}

function install(name, agents) {
  const source = path.join(SKILLS_REPO, name);
  if (!fs.existsSync(source)) {
    console.error(`Skill "${name}" not found. Available: ${getSkills().join(', ')}`);
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
  ensureRepo();
  run('git pull --ff-only', { cwd: SKILLS_REPO });

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
  ensureRepo();
  run('git add . && git commit || true', { cwd: SKILLS_REPO });
  run('git push', { cwd: SKILLS_REPO });
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case 'install':
    ensureRepo();
    if (args[0]) {
      install(args[0], args.slice(1));
    } else {
      for (const s of getSkills()) install(s);
    }
    break;
  case 'sync':
    sync();
    break;
  case 'publish':
    publish();
    break;
  case 'list':
    ensureRepo();
    console.log(getSkills().join('\n'));
    break;
  default:
    console.log('Commands:\n  install [name] [agent...]  Clone repo + symlink skill(s). Omit name for all.\n  sync                       Pull updates + restore symlinks\n  publish                    Commit & push changes\n  list                       Show available skills');
}
