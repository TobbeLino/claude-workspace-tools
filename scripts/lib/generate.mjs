// Umbrella workspace generator: one folder that serves Claude Code, WebStorm and Cursor.
//
//   <outDir>/<name>.code-workspace   Cursor / VS Code
//   <outDir>/Workspace/              WebStorm project + Claude Code cwd
//     CLAUDE.md, .claude/settings.json, .idea/
//
// The inner folder is literally named "Workspace" so WebStorm's project view
// (always "<folder> [<module>]") reads "Workspace [<name>]".

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultWorkspacesRoot() {
  return process.env.CLAUDE_WORKSPACES_ROOT || path.join(os.homedir(), 'projects', 'Workspaces');
}

const toSlash = (p) => p.split(path.sep).join('/');
const trimSlash = (p) => p.replace(/[\\/]+$/, '');

// .code-workspace is JSONC: strip /* */ and whole-line // comments and trailing commas.
function parseJsonc(text) {
  const cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned);
}

function folderEntry(p, name, warn) {
  if (!fs.existsSync(p)) {
    warn(`Folder not found, skipping: ${p}`);
    return null;
  }
  const full = fs.realpathSync.native(p);
  return {
    name: name || path.basename(full),
    path: toSlash(full),
    isGit: fs.existsSync(path.join(full, '.git')),
  };
}

// Returns the repo folders plus every other top-level key (settings, launch, tasks, extensions, ...).
export function readCodeWorkspace(file, warn = console.warn) {
  const abs = path.resolve(file);
  const { folders = [], ...rest } = parseJsonc(fs.readFileSync(abs, 'utf8'));
  const wsDir = path.dirname(abs);
  const repos = folders
    .map((f) => folderEntry(path.isAbsolute(f.path) ? f.path : path.join(wsDir, f.path), f.name, warn))
    .filter(Boolean);
  return { repos, rest };
}

// Instruction files written for Claude Code and other agents. Claude Code loads none of
// them from additionalDirectories (not even CLAUDE.md / AGENTS.md by default), so the
// umbrella CLAUDE.md @-imports the always-on ones and lists the scoped ones by path.

// Single files that always apply to the whole repo.
const ALWAYS_FILES = [
  'AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md',
  '.cursorrules', '.windsurfrules', '.clinerules', '.github/copilot-instructions.md',
];

// Rule folders; `always(fm)` decides from a file's frontmatter whether it applies everywhere.
const RULE_DIRS = [
  { dir: '.cursor/rules', always: (fm) => /^alwaysApply:\s*true\b/m.test(fm) },
  { dir: '.claude/rules', always: (fm) => !/^paths:/m.test(fm) },
  { dir: '.windsurf/rules', always: (fm) => /^trigger:\s*always_on\b/m.test(fm) },
  { dir: '.github/instructions', always: () => false, match: /\.instructions\.md$/i },
  { dir: '.clinerules', always: () => true }, // Cline loads every file in the folder
  { dir: '.devin/rules', always: () => false },
];

// Frontmatter fields that say when a scoped rule applies.
const SCOPE_FIELDS = ['globs', 'paths', 'applyTo', 'trigger', 'description'];

function walk(dir, match) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p, match));
    else if (match.test(e.name)) out.push(p);
  }
  return out;
}

const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile();
const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory();

function frontmatter(file) {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'))?.[1] || '';
}

function scopeOf(fm) {
  const field = (k) => {
    // Inline value, or a YAML list on the following lines.
    const m = new RegExp(`^${k}:[ \\t]*(.*)((?:\\r?\\n[ \\t]*-.*)*)`, 'm').exec(fm);
    if (!m) return null;
    const items = m[2].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    return [m[1].trim(), ...items].filter(Boolean).map((v) => v.replace(/^["']|["']$/g, '')).join(', ');
  };
  return SCOPE_FIELDS.map((k) => [k, field(k)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ') || 'manual';
}

/** @returns {{ file: string, always: boolean, scope: string | null }[]} paths relative to the repo */
export function findAgentDocs(repoPath) {
  const docs = ALWAYS_FILES
    .filter((f) => isFile(path.join(repoPath, f)))
    .map((f) => ({ file: f, always: true, scope: null }));
  for (const { dir, always, match = /\.mdc?$/i } of RULE_DIRS) {
    const abs = path.join(repoPath, dir);
    if (!isDir(abs)) continue;
    for (const p of walk(abs, match).sort()) {
      const fm = frontmatter(p);
      const on = always(fm);
      docs.push({ file: toSlash(path.relative(repoPath, p)), always: on, scope: on ? null : scopeOf(fm) });
    }
  }
  return docs;
}

// `@path` imports stop at whitespace, so such paths can only be listed.
const importable = (p) => !/\s/.test(p);

function docsSection(repos, imports) {
  const found = repos.map((r) => ({ r, docs: findAgentDocs(r.path) })).filter(({ docs }) => docs.length);
  if (!found.length) return '';
  const load = [];
  const scoped = [];
  for (const { r, docs } of found) {
    const abs = (d) => `${r.path}/${d.file}`;
    const on = docs.filter((d) => d.always);
    const toImport = imports ? on.filter((d) => importable(abs(d))) : [];
    const toList = on.filter((d) => !toImport.includes(d));
    if (toImport.length || toList.length) {
      load.push(`### ${r.name}`, ...toImport.map((d) => `@${abs(d)}`), ...toList.map((d) => `- \`${abs(d)}\``), '');
    }
    const s = docs.filter((d) => !d.always);
    if (s.length) scoped.push(`- **${r.name}**`, ...s.map((d) => `  - \`${abs(d)}\` (${d.scope})`));
  }
  const intro = imports
    ? `Instruction files the repos carry for Claude Code and other agents. Claude Code does
not load them from additional directories, so the ones that always apply are imported
below. Each one applies only to its own repo. The first session asks once to approve
these external imports.`
    : `Instruction files the repos carry for Claude Code and other agents. Claude Code does
not load them from additional directories. Read a repo's always-on files below the
first time a task touches that repo, questions and explanations included. Each one
applies only to its own repo.`;
  return `
## Repo docs for AI tools
${intro}

${load.length ? `${load.join('\n')}\n` : ''}${scoped.length ? `### Scoped: read when the task matches
Do not read these up front. Open one only when the task touches files or topics
matching its scope.
${scoped.join('\n')}

` : ''}Found when this umbrella was generated. Regenerate to pick up new files.
`;
}

const MINIMAL_IML = `<?xml version="1.0" encoding="UTF-8"?>
<module type="WEB_MODULE" version="4">
  <component name="NewModuleRootManager">
    <content url="file://$MODULE_DIR$">
      <excludeFolder url="file://$MODULE_DIR$/.tmp" />
      <excludeFolder url="file://$MODULE_DIR$/temp" />
      <excludeFolder url="file://$MODULE_DIR$/tmp" />
    </content>
    <orderEntry type="inheritedJdk" />
    <orderEntry type="sourceFolder" forTests="false" />
  </component>
</module>
`;

/**
 * @param {object} opts
 * @param {string} [opts.workspaceFile]  source *.code-workspace (file mode)
 * @param {string} [opts.name]           workspace name (list mode)
 * @param {string[]} [opts.folders]      repo folders (list mode)
 * @param {string} [opts.outDir]         umbrella root; defaults to <workspacesRoot>/<name>
 * @param {string} [opts.workspacesRoot]
 * @param {boolean} [opts.force]         overwrite an existing umbrella
 * @param {boolean} [opts.imports]       @-import the repos' always-on agent docs (default true); false lists them
 * @param {(msg: string) => void} [opts.warn]
 */
export function generate(opts) {
  const warn = opts.warn || console.warn;
  let repos, wsName, source, sourceFile = null, wsRest = null;

  if (opts.workspaceFile) {
    sourceFile = path.resolve(opts.workspaceFile);
    wsName = path.basename(sourceFile, path.extname(sourceFile));
    source = toSlash(sourceFile);
    ({ repos, rest: wsRest } = readCodeWorkspace(sourceFile, warn));
  } else {
    if (!opts.name || !opts.folders?.length) throw new Error('Need --workspace <file>, or --name <n> --folders <p1> <p2> ...');
    wsName = opts.name;
    source = 'an explicit folder list';
    repos = opts.folders.map((p) => folderEntry(path.resolve(p), null, warn)).filter(Boolean);
  }

  let outDir;
  if (opts.outDir) {
    outDir = path.resolve(opts.outDir);
    wsName = path.basename(outDir); // folder name wins over file name
  } else {
    outDir = path.join(opts.workspacesRoot || defaultWorkspacesRoot(), wsName);
  }
  if (fs.existsSync(outDir) && !opts.force) {
    throw new Error(`${outDir} already exists. Use --force to overwrite the generated files.`);
  }

  const projDir = path.join(outDir, 'Workspace');
  fs.mkdirSync(path.join(projDir, '.claude'), { recursive: true });
  const projReal = trimSlash(fs.realpathSync.native(projDir));

  // The umbrella's own folder may appear in a re-imported .code-workspace; it is not a repo.
  repos = repos.filter((r) => trimSlash(r.path.split('/').join(path.sep)) !== projReal);
  if (!repos.length) throw new Error(`No usable folders from ${source}`);

  // --- <name>.code-workspace (Cursor / VS Code) ---
  const wsFile = path.join(outDir, `${wsName}.code-workspace`);
  const wsFileIsSource = sourceFile && path.resolve(sourceFile) === path.resolve(wsFile);
  if (!wsFileIsSource) {
    // List mode has no source file: keep what the umbrella being overwritten already had.
    if (!wsRest && fs.existsSync(wsFile)) {
      try { wsRest = readCodeWorkspace(wsFile, () => {}).rest; } catch { warn(`Could not parse ${wsFile}; its settings are not kept`); }
    }
    const wsJson = {
      folders: [
        { name: `Workspace (${wsName})`, path: 'Workspace' },
        // Cursor / VS Code default a folder's name to its basename; keep any other name
        // (`${workspaceFolder:<name>}` in launch/tasks resolves by it).
        ...repos.map((r) => ({
          path: toSlash(path.relative(outDir, r.path)),
          ...(r.name !== path.basename(r.path) && { name: r.name }),
        })),
      ],
      settings: {},
      ...wsRest,
    };
    fs.writeFileSync(wsFile, JSON.stringify(wsJson, null, 2) + '\n');
  }

  // --- .claude/settings.json ---
  const settings = { permissions: { additionalDirectories: repos.map((r) => r.path) } };
  fs.writeFileSync(path.join(projDir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');

  // --- CLAUDE.md ---
  const rows = repos.map((r) => `| ${r.name} | \`${r.path}\` | ${r.isGit ? 'git' : '-'} |`).join('\n');
  fs.writeFileSync(path.join(projDir, 'CLAUDE.md'), `# Workspace: ${wsName}

Umbrella project generated from ${source} by claude-workspace-tools.
This folder holds no code — it only references the repos below (via
\`.claude/settings.json\` → \`permissions.additionalDirectories\` and \`.idea/\`
for WebStorm; \`../${wsName}.code-workspace\` is the same set for Cursor / VS Code).
Treat all of them as one workspace.

| Repo | Path | VCS |
|---|---|---|
${rows}
${docsSection(repos, opts.imports !== false)}
## Working here
- Always state which repo a file belongs to.
- Run git per repo: \`git -C <path> ...\`. Each repo has its own branch/status.
- Search across all repos (pass the paths to Glob/Grep), not just this folder.
- To change the repo set: edit \`../${wsName}.code-workspace\` and run
  \`/import-workspace\` on it (or \`/save-workspace\` from WebStorm).
`);

  // --- .idea (WebStorm project with all repos attached) ---
  // "Attach project" in WebStorm = extra <module> entries in modules.xml pointing at
  // each repo's own .idea/<name>.iml, plus git mappings in vcs.xml.
  const ideaDir = path.join(projDir, '.idea');
  fs.mkdirSync(ideaDir, { recursive: true });
  // Stale module files from a previous generation / IDE rename would otherwise linger.
  for (const f of fs.readdirSync(ideaDir)) if (f.endsWith('.iml')) fs.rmSync(path.join(ideaDir, f));

  // Path relative to the WebStorm project dir, IntelliJ style; absolute when on another drive.
  const rel = (target) => {
    const r = path.relative(projDir, target);
    return path.isAbsolute(r) ? toSlash(r) : `$PROJECT_DIR$/${toSlash(r)}`;
  };

  const moduleXml = [];
  const vcsXml = [];
  const orderXml = [];
  const moduleNames = new Set();
  const createdImls = [];
  for (const r of repos) {
    const repoIdea = path.join(r.path, '.idea');
    let imlPath = fs.existsSync(repoIdea)
      ? fs.readdirSync(repoIdea).filter((f) => f.endsWith('.iml')).map((f) => path.join(repoIdea, f))[0]
      : undefined;
    if (!imlPath) {
      // Repo has never been opened in WebStorm: create the same minimal module it would.
      imlPath = path.join(repoIdea, `${r.name}.iml`);
      fs.mkdirSync(repoIdea, { recursive: true });
      fs.writeFileSync(imlPath, MINIMAL_IML);
      createdImls.push(imlPath);
    }
    const imlRel = rel(imlPath);
    const moduleName = path.basename(imlPath, '.iml');
    moduleNames.add(moduleName.toLowerCase());
    moduleXml.push(`      <module fileurl="file://${imlRel}" filepath="${imlRel}" />`);
    orderXml.push(`    <orderEntry type="module" module-name="${moduleName}" />`);
    if (r.isGit) vcsXml.push(`    <mapping directory="${rel(r.path)}" vcs="Git" />`);
  }

  // WebStorm identifies modules by name: an umbrella named after one of its repos
  // (e.g. Agent.code-workspace holding the Agent repo) would shadow that repo's module.
  let umbrellaModule = wsName;
  for (let i = 2; moduleNames.has(umbrellaModule.toLowerCase()); i++) {
    umbrellaModule = i === 2 ? `${wsName}.workspace` : `${wsName}.workspace${i}`;
  }
  const umbrellaIml = `${umbrellaModule}.iml`;
  fs.writeFileSync(path.join(ideaDir, umbrellaIml), `<?xml version="1.0" encoding="UTF-8"?>
<module type="WEB_MODULE" version="4">
  <component name="NewModuleRootManager">
    <content url="file://$MODULE_DIR$" />
    <orderEntry type="inheritedJdk" />
    <orderEntry type="sourceFolder" forTests="false" />
${orderXml.join('\n')}
  </component>
</module>
`);
  fs.writeFileSync(path.join(ideaDir, 'modules.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectModuleManager">
    <modules>
      <module fileurl="file://$PROJECT_DIR$/.idea/${umbrellaIml}" filepath="$PROJECT_DIR$/.idea/${umbrellaIml}" />
${moduleXml.join('\n')}
    </modules>
  </component>
</project>
`);
  fs.writeFileSync(path.join(ideaDir, 'vcs.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="VcsDirectoryMappings">
${vcsXml.join('\n')}
  </component>
</project>
`);
  fs.writeFileSync(path.join(ideaDir, 'misc.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectRootManager">
    <output url="file://$PROJECT_DIR$/out" />
  </component>
</project>
`);
  fs.writeFileSync(path.join(ideaDir, '.gitignore'), '# WebStorm user-specific state\nworkspace.xml\nshelf/\n');
  // Window title / project name (the folder is "Workspace", so without this every umbrella would be titled the same).
  fs.writeFileSync(path.join(ideaDir, '.name'), wsName);

  return { name: wsName, outDir, projDir, wsFile, repos, createdImls };
}
