import fs from 'node:fs';
import path from 'node:path';

function isWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate);
  return (allowRoot && relative === '') || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpath(value, label) {
  try { return fs.realpathSync(value); }
  catch (error) { throw new Error(`${label || 'Path'} cannot be resolved: ${error.message}`); }
}

// Check lexical containment first, then anchor the check to the real project
// root. For a not-yet-created output, resolve its nearest existing parent so
// a symlinked parent cannot redirect the write outside the allowed root.
export function scopedPath(root, candidate, { allowRoot = false, mustExist = false, label = 'Path' } = {}) {
  const lexicalRoot = path.resolve(String(root));
  const lexicalCandidate = path.resolve(String(candidate));
  if (!isWithin(lexicalRoot, lexicalCandidate, allowRoot)) {
    throw new Error(`${label} escapes allowed root: ${lexicalCandidate}`);
  }
  if (mustExist && !fs.existsSync(lexicalCandidate)) {
    throw new Error(`${label} does not exist: ${lexicalCandidate}`);
  }
  const realRoot = realpath(lexicalRoot, 'Allowed root');
  let realCandidate;
  if (fs.existsSync(lexicalCandidate)) {
    realCandidate = realpath(lexicalCandidate, label);
  } else {
    let cursor = lexicalCandidate;
    const suffix = [];
    while (!fs.existsSync(cursor)) {
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error(`${label} has no existing parent: ${lexicalCandidate}`);
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
    realCandidate = path.join(realpath(cursor, label), ...suffix);
  }
  if (!isWithin(realRoot, realCandidate, allowRoot)) {
    throw new Error(`${label} resolves outside allowed root: ${realCandidate}`);
  }
  return lexicalCandidate;
}

export function scopedProject(value, { label = 'Project root' } = {}) {
  if (!value || !path.isAbsolute(String(value))) throw new Error(`${label} must be an absolute path`);
  const root = path.resolve(String(value));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${label} does not exist: ${root}`);
  scopedPath(root, root, { allowRoot: true, mustExist: true, label });
  return root;
}

export function scopedTaskDirectory(root, taskId, { requireState = true } = {}) {
  if (!taskId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(String(taskId))
    || new Set(['_template', '_archive', 'continuous']).has(String(taskId))) {
    throw new Error(`Invalid task id "${taskId || ''}"; path traversal is not allowed`);
  }
  const tasks = scopedPath(root, path.join(root, 'Harness', 'tasks'), { mustExist: true, label: 'Harness/tasks' });
  const taskDir = scopedPath(tasks, path.join(tasks, String(taskId)), { mustExist: true, label: 'Task directory' });
  if (!fs.statSync(taskDir).isDirectory()) throw new Error(`Task is not a directory: ${taskId}`);
  if (requireState) scopedPath(tasks, path.join(taskDir, 'STATE.json'), { mustExist: true, label: 'Task STATE.json' });
  return taskDir;
}

export function scopedGlobalRoot(value, projectRoot) {
  const global = scopedProject(value, { label: '--global-root' });
  const globalReal = realpath(global, '--global-root');
  const projectReal = projectRoot ? realpath(projectRoot, '--project') : null;
  if (projectReal && (isWithin(projectReal, globalReal, true) || isWithin(globalReal, projectReal, true))) {
    throw new Error('--global-root must be a different isolated root from --project');
  }
  return global;
}

export { isWithin };
