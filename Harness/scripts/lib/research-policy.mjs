import fs from 'node:fs';
import path from 'node:path';
import { scopedPath, scopedProject, scopedTaskDirectory } from './path-scope.mjs';

const TRIGGERS = new Map([
  ['capability-gap', 'A capability gap should be checked against current primary sources.'],
  ['volatile-api', 'API behavior or version information may have changed.'],
  ['user-request', 'The user explicitly requested external verification.'],
  ['repeated-failure', 'Repeated failure is a signal to inspect current guidance and known fixes.'],
  ['benchmark-gap', 'A benchmark gap needs an evidence-backed comparison before changing the harness.'],
]);
const DECISIONS = new Set(['adopt', 'adapt', 'reject']);
const SOURCE_TYPES = new Set(['official', 'author']);

export function projectRoot(value) {
  return scopedProject(value, { label: '--project' });
}

function readJsonInput(value, root = null) {
  if (!value) throw new Error('--input JSON is required');
  const candidate = root && !path.isAbsolute(String(value)) ? path.resolve(root, String(value)) : String(value);
  const inputFile = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
  if (inputFile && root) scopedPath(root, inputFile, { mustExist: true, label: '--input' });
  const raw = inputFile ? fs.readFileSync(inputFile, 'utf8') : value;
  try { return JSON.parse(raw); } catch (error) { throw new Error(`Invalid JSON input: ${error.message}`); }
}

export function decide({ trigger, taskType = 'chore' }) {
  const reasons = [];
  if (trigger) {
    const values = (Array.isArray(trigger) ? trigger : [trigger])
      .flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean);
    for (const value of values) {
      if (!TRIGGERS.has(value)) throw new Error(`Invalid trigger "${value}". Valid: ${[...TRIGGERS.keys()].join(', ')}`);
      reasons.push(TRIGGERS.get(value));
    }
  }
  return { search: reasons.length > 0, reasons, addDependency: false, taskType };
}

export function validateReference(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['reference must be a JSON object'] };
  for (const field of ['url', 'title', 'version', 'license', 'reason', 'checkedAt']) {
    if (typeof value[field] !== 'string' || !value[field].trim()) errors.push(`${field} must be a non-empty string`);
  }
  try {
    const url = new URL(value.url);
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('url must use http or https');
  } catch { errors.push('url must be an absolute http(s) URL'); }
  if (!SOURCE_TYPES.has(value.sourceType)) errors.push('sourceType must be official or author');
  if (!DECISIONS.has(value.decision)) errors.push('decision must be adopt, adapt, or reject');
  if (!Array.isArray(value.acIds)) errors.push('acIds must be an array');
  for (const field of ['counterexample', 'recheckTrigger', 'recheckAfter']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (value.decision === 'adopt' && !String(value.license || '').trim()) errors.push('adopting a code dependency requires a license');
  if (value.checkedAt && Number.isNaN(Date.parse(value.checkedAt))) errors.push('checkedAt must be an ISO date');
  return { valid: errors.length === 0, errors };
}

export function recordReference({ root, taskId, reference, apply = false }) {
  const validation = validateReference(reference);
  if (!validation.valid) return { ok: false, errors: validation.errors, dryRun: !apply };
  if (!taskId) return { ok: false, errors: ['--task is required'], dryRun: !apply };
  let taskDir;
  // Legacy capsules may predate STATE.json; the task id and canonical capsule
  // directory are still checked, and REFERENCES.md is the record target.
  try { taskDir = scopedTaskDirectory(root, taskId, { requireState: false }); }
  catch (error) { return { ok: false, errors: [error.message], dryRun: !apply }; }
  const target = scopedPath(root, path.join(taskDir, 'REFERENCES.md'), { label: 'References target' });
  if (!fs.existsSync(target)) return { ok: false, errors: [`Task references not found: ${taskId}`], dryRun: !apply };
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '# Research references\n';
  if (!apply) return { ok: false, dryRun: true, errors: ['Dry run only. Re-run with --apply to write references.'] };
  if (current.includes(reference.url)) return { ok: true, action: 'duplicate', taskId, path: path.relative(root, target).replaceAll('\\', '/') };
  const acIds = reference.acIds.length ? reference.acIds.join(', ') : 'none';
  const block = [
    `\n## ${reference.title}`,
    `- URL: ${reference.url}`,
    `- Source type: ${reference.sourceType}`,
    `- Version: ${reference.version}`,
    `- License: ${reference.license}`,
    `- Decision: ${reference.decision}`,
    `- Reason: ${String(reference.reason).replace(/[\r\n]+/g, ' ').trim()}`,
    `- AC IDs: ${acIds}`,
    `- Checked at: ${reference.checkedAt}`,
    ...(reference.counterexample ? [`- Counterexample: ${String(reference.counterexample).replace(/[\r\n]+/g, ' ').trim()}`] : []),
    ...((reference.recheckTrigger || reference.recheckAfter) ? [`- Recheck trigger: ${String(reference.recheckTrigger || reference.recheckAfter).replace(/[\r\n]+/g, ' ').trim()}`] : []),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, current + (current.endsWith('\n') ? '' : '\n') + block, 'utf8');
  return { ok: true, action: 'recorded', taskId, path: path.relative(root, target).replaceAll('\\', '/') };
}

export function readInput(value, root = null) { return readJsonInput(value, root); }
export { TRIGGERS, DECISIONS, SOURCE_TYPES };
