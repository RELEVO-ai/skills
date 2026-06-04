#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const REPO_URL_SSH = 'git@github.com:RELEVO-ai/skills.git';
const REPO_URL_HTTPS = 'https://github.com/RELEVO-ai/skills.git';
const HOME = os.homedir();
const SKILLS_REPO = path.join(HOME, '.relevo', 'skills');

// Carpetas globales de skills que escanean los agentes. Estos 4 targets cubren
// ~13 agentes (research en references/cross-agent-support.md de skill-authoring):
//   .agents/skills        → Zed, OpenCode, Gemini, Amp, Cursor, Cline, Warp, Antigravity, Copilot
//   .claude/skills        → Claude Code
//   .codex/skills         → Codex
//   .config/agents/skills → Kimi, Amp (alt)
// os.homedir() + path.join → funciona igual en macOS/Linux/Windows.
const SKILL_DIRS = [
  path.join(HOME, '.agents', 'skills'),
  path.join(HOME, '.claude', 'skills'),
  path.join(HOME, '.codex', 'skills'),
  path.join(HOME, '.config', 'agents', 'skills'),
];
// En Windows el symlink de carpeta requiere 'junction' (no pide admin).
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

function run(cmd, opts = {}) {
  try { execSync(cmd, { stdio: 'inherit', ...opts }); } catch {}
}

function cloneRepo() {
  console.log('Cloning RELEVO-ai/skills...');
  try {
    execSync(`git clone ${REPO_URL_SSH} "${SKILLS_REPO}"`, { stdio: 'inherit' });
  } catch {
    try {
      execSync(`gh repo clone RELEVO-ai/skills "${SKILLS_REPO}"`, { stdio: 'inherit' });
    } catch {
      execSync(`git clone ${REPO_URL_HTTPS} "${SKILLS_REPO}"`, { stdio: 'inherit' });
    }
  }
}

function ensureRepo() {
  if (!fs.existsSync(path.join(SKILLS_REPO, '.git'))) cloneRepo();
}

function getSkills() {
  return fs.readdirSync(SKILLS_REPO, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'cli')
    .map(d => d.name);
}

function linkSkill(name) {
  const source = path.join(SKILLS_REPO, name);
  if (!fs.existsSync(source)) {
    console.error(`Skill "${name}" not found. Available: ${getSkills().join(', ')}`);
    process.exit(1);
  }
  for (const dir of SKILL_DIRS) {
    const link = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const s = fs.lstatSync(link);
      if (s.isSymbolicLink() || s.isDirectory()) fs.rmSync(link, { recursive: true, force: true });
    } catch {}
    try {
      fs.symlinkSync(source, link, LINK_TYPE);
      console.log(`  + ${link}`);
    } catch (e) {
      console.warn(`  ! no pude linkear ${link}: ${e.message}`);
    }
  }
}

function sync() {
  ensureRepo();
  run('git pull --ff-only', { cwd: SKILLS_REPO });
  for (const name of getSkills()) {
    const source = path.join(SKILLS_REPO, name);
    for (const dir of SKILL_DIRS) {
      const link = path.join(dir, name);
      try {
        const s = fs.lstatSync(link);
        if (s.isSymbolicLink() && fs.readlinkSync(link) === source) continue;
      } catch {}
      fs.mkdirSync(dir, { recursive: true });
      try { fs.rmSync(link, { recursive: true, force: true }); } catch {}
      try { fs.symlinkSync(source, link, LINK_TYPE); console.log(`  + ${link} (restored)`); } catch {}
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
    if (args[0]) linkSkill(args[0]);
    else for (const s of getSkills()) linkSkill(s);
    break;
  case 'sync': sync(); break;
  case 'publish': publish(); break;
  case 'list': ensureRepo(); console.log(getSkills().join('\n')); break;
  default:
    console.log([
      'Commands:',
      '  install [name]   Symlink skill(s) a las carpetas de todos los agentes. Sin name = todas.',
      '  sync             git pull + restaurar symlinks',
      '  publish          git add/commit/push',
      '  list             Skills disponibles',
    ].join('\n'));
}
