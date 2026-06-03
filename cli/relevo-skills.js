#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SKILLS_REPO = path.resolve(process.env.HOME, '.relevo/skills');
const SKILLS_JSON = path.join(SKILLS_REPO, 'skills.json');
const REGISTRY = JSON.parse(fs.readFileSync(SKILLS_JSON, 'utf-8'));

const AGENT_CONFIGS = {
  opencode: {
    dir: path.resolve(process.env.HOME, '.config/opencode/skills'),
  },
  'claude-code': {
    dir: path.resolve(process.env.HOME, '.claude/skills'),
  },
  codex: {
    dir: path.resolve(process.env.HOME, '.codex/skills'),
  },
  cursor: {
    dir: path.resolve(process.env.HOME, '.cursor/skills'),
  },
};

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: SKILLS_REPO, stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}

function getAllSkillNames() {
  return REGISTRY.skills.map(s => s.name);
}

function getSkill(name) {
  return REGISTRY.skills.find(s => s.name === name);
}

function installSkill(name, agents) {
  const skill = getSkill(name);
  if (!skill) {
    console.error(`Skill "${name}" not found. Available: ${getAllSkillNames().join(', ')}`);
    process.exit(1);
  }

  const targets = agents || Object.keys(AGENT_CONFIGS);
  const sourceDir = path.join(SKILLS_REPO, path.dirname(skill.path));
  const sourceExists = fs.existsSync(sourceDir);

  if (!sourceExists) {
    console.error(`Source not found: ${sourceDir}. Run sync first.`);
    process.exit(1);
  }

  let installed = 0;
  for (const agent of targets) {
    const config = AGENT_CONFIGS[agent];
    if (!config) {
      console.warn(`Unknown agent: ${agent}, skipping`);
      continue;
    }

    const linkPath = path.join(config.dir, name);
    fs.mkdirSync(config.dir, { recursive: true });

    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        fs.rmSync(linkPath, { recursive: true, force: true });
      }
    } catch { }

    fs.symlinkSync(sourceDir, linkPath);
    console.log(`  + ${agent}: ${linkPath}`);
    installed++;
  }

  console.log(`\nInstalled "${name}" in ${installed} agent(s).`);
}

function sync() {
  console.log('Pulling latest skills...');
  run('git pull --ff-only');

  const targets = Object.keys(AGENT_CONFIGS);
  const names = getAllSkillNames();

  for (const name of names) {
    const skill = getSkill(name);
    const sourceDir = path.join(SKILLS_REPO, path.dirname(skill.path));

    for (const agent of targets) {
      const config = AGENT_CONFIGS[agent];
      const linkPath = path.join(config.dir, name);

      try {
        const stat = fs.lstatSync(linkPath);
        if (!stat.isSymbolicLink()) {
          console.warn(`  - ${agent}/${name}: not a symlink, skipping`);
          continue;
        }
        const target = fs.readlinkSync(linkPath);
        if (target !== sourceDir) {
          console.warn(`  - ${agent}/${name}: points elsewhere, skipping`);
          continue;
        }
      } catch {
        fs.mkdirSync(config.dir, { recursive: true });
        fs.symlinkSync(sourceDir, linkPath);
        console.log(`  + ${agent}/${name}: restored`);
      }
    }
  }

  console.log('Sync complete.');
}

function publish() {
  run('git add .');
  run('git commit');
  run('git push');
}

function list() {
  console.log('Available skills:\n');
  for (const skill of REGISTRY.skills) {
    console.log(`  ${skill.name}@${skill.version}  —  ${skill.description}`);
    console.log(`    tags: ${skill.tags.join(', ')}`);
    console.log(`    agents: ${skill.agents.join(', ')}`);
    console.log();
  }
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case 'install':
    if (!args[0]) {
      console.error('Usage: relevo-skills install <name> [agent...]');
      process.exit(1);
    }
    installSkill(args[0], args.slice(1));
    break;
  case 'sync':
    sync();
    break;
  case 'publish':
    publish();
    break;
  case 'list':
    list();
    break;
  default:
    console.log(`
Usage: relevo-skills <command>

Commands:
  install <name> [agent...]  Install a skill (default: all agents)
  sync                       Pull latest + fix missing symlinks
  publish                    Commit & push local changes
  list                       Show available skills
`);
}
