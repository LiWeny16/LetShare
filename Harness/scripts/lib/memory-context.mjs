import fs from 'node:fs';
import path from 'node:path';
import {
  scopedGlobalRoot,
  scopedPath,
  scopedProject,
  scopedTaskDirectory,
} from './path-scope.mjs';

const MEMORY_MARKER = /^\s*<!--\s*harness-memory:\s*(\{.*\})\s*-->\s*$/i;
const WHEN_BULLET = /^\s*-\s+When\s+(.+?):\s+(.+)$/i;
const VALID_SCOPES = new Set(['project', 'global', 'task']);
const VALID_KINDS = new Set(['method', 'preference']);
const VALID_STATUSES = new Set(['active', 'inactive', 'superseded']);

export function projectRoot(value) {
  return scopedProject(value, { label: '--project' });
}

function readJsonInput(value, root = null) {
  if (!value) throw new Error('--input JSON is required');
  const candidate = root && !path.isAbsolute(String(value)) ? path.resolve(root, String(value)) : String(value);
  const inputFile = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
  if (inputFile && root) scopedPath(root, inputFile, { mustExist: true, label: '--input' });
  const raw = inputFile ? fs.readFileSync(inputFile, 'utf8') : value;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error.message}`);
  }
}

function walkMarkdown(root, dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(root, file, result);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      result.push(scopedPath(root, file, { mustExist: true, label: 'Memory file' }));
    }
  }
  return result;
}

function safeRelative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function parseBullet(line) {
  const match = line.match(WHEN_BULLET);
  if (!match) return null;
  let body = match[2].trim();
  let avoid = '';
  let signals = [];
  const avoidMatch = body.match(/\s+Avoid\s*:\s*(.*?)(?=\s+Signals\s*:|$)/i);
  if (avoidMatch) {
    avoid = avoidMatch[1].trim().replace(/[.]$/, '');
    body = body.replace(avoidMatch[0], '').trim();
  }
  const signalsMatch = body.match(/\s+Signals\s*:\s*(.*)$/i);
  if (signalsMatch) {
    signals = signalsMatch[1].replace(/[.]$/, '').split(',').map(s => s.trim()).filter(Boolean);
    body = body.replace(signalsMatch[0], '').trim();
  }
  return { when: match[1].trim(), rule: body.replace(/[.]$/, ''), avoid, signals };
}

function parseEntries(root, files) {
  const entries = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let pending = null;
    let pendingMarkerLine = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const marker = line.match(MEMORY_MARKER);
      if (marker) {
        try { pending = JSON.parse(marker[1]); pendingMarkerLine = index; } catch { pending = null; pendingMarkerLine = null; }
        continue;
      }
      const bullet = parseBullet(line);
      if (!bullet) {
        pending = null;
        pendingMarkerLine = null;
        continue;
      }
      const metadata = pending && typeof pending === 'object' ? { ...pending } : null;
      const value = metadata ? { ...bullet, ...metadata } : { ...bullet };
      const id = String(value.id || `${safeRelative(root, file)}:${index + 1}`);
      entries.push({
        ...value,
        metadataValue: metadata,
        id,
        path: safeRelative(root, file),
        line: index + 1,
        metadata: Boolean(metadata),
        raw: line,
        markerLine: metadata ? pendingMarkerLine : null,
        file,
        sourceBytes: Buffer.byteLength(metadata
          ? `${lines[index - 1] || ''}\n${line}\n`
          : `${line}\n`, 'utf8'),
      });
      pending = null;
      pendingMarkerLine = null;
    }
  }
  return entries;
}

function statusReason(entry) {
  if (entry.status === 'inactive') return 'inactive memory entry';
  if (entry.status === 'superseded') {
    return entry.supersededBy
      ? `superseded by ${entry.supersededBy}`
      : 'superseded memory entry';
  }
  if (entry.recheckAfter) {
    const time = Date.parse(entry.recheckAfter);
    if (Number.isFinite(time) && time <= Date.now()) {
      return `recheckAfter ${entry.recheckAfter} has passed; verification required`;
    }
  }
  return null;
}

function scopeMatches(entry, scope, taskId) {
  if (scope === 'task') {
    if (entry.scope && entry.scope !== 'task') return false;
    return !taskId || entry.path.includes(`/tasks/${taskId}/`) || entry.path.includes(`tasks/${taskId}/`);
  }
  if (!entry.scope) return scope === 'project';
  return entry.scope === scope;
}

function explain(entry, terms) {
  const matches = terms.filter(term => {
    const haystack = `${entry.when} ${entry.rule} ${entry.avoid || ''} ${(entry.signals || []).join(' ')}`.toLowerCase();
    return haystack.includes(term);
  });
  const parts = [entry.metadata ? 'metadata-backed' : 'legacy entry without harness-memory metadata'];
  if (matches.length) parts.push(`matched ${matches.join(', ')}`);
  if (entry.conflictsWith) parts.push(`conflictsWith ${[].concat(entry.conflictsWith).join(', ')}`);
  if (entry.recheckAfter) parts.push(`recheckAfter ${entry.recheckAfter}`);
  return parts.join('; ');
}

export function queryMemory({ root, globalRoot = null, text = '', scope = 'project', taskId, topK = 5, budgetBytes = 8192 }) {
  if (!VALID_SCOPES.has(scope)) throw new Error(`Invalid scope "${scope}". Valid: project, global, task`);
  const storageRoot = scope === 'global' ? scopedGlobalRoot(globalRoot, root) : root;
  const memoryDir = scopedPath(storageRoot, path.join(storageRoot, 'Harness', 'memory'), { label: 'Harness/memory' });
  const taskDir = scopedPath(root, path.join(root, 'Harness', 'tasks'), { mustExist: true, label: 'Harness/tasks' });
  if (scope === 'task' && taskId) scopedTaskDirectory(root, taskId);
  const dirs = scope === 'task' ? [taskDir] : [memoryDir];
  const files = dirs.flatMap(dir => walkMarkdown(scope === 'task' ? root : storageRoot, dir));
  const entries = parseEntries(scope === 'task' ? root : storageRoot, files);
  const terms = String(text).toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
  const skipped = [];
  const candidates = [];
  for (const entry of entries) {
    if (!scopeMatches(entry, scope, taskId)) {
      skipped.push({ id: entry.id, reason: `scope ${entry.scope || 'project'} is not applicable to ${scope}` });
      continue;
    }
    const inactiveReason = statusReason(entry);
    if (inactiveReason) {
      skipped.push({ id: entry.id, reason: inactiveReason });
      continue;
    }
    const haystack = `${entry.when} ${entry.rule} ${entry.avoid || ''} ${(entry.signals || []).join(' ')}`.toLowerCase();
    const matched = terms.length === 0 || terms.every(term => haystack.includes(term)) || terms.some(term => haystack.includes(term));
    if (!matched) continue;
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    candidates.push({ entry, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path) || a.entry.line - b.entry.line);
  const limit = nonNegativeInteger(budgetBytes, '--budget-bytes', 8192);
  const count = nonNegativeInteger(topK, '--top-k', 5);
  let usedBytes = 0;
  const hits = [];
  for (const { entry, score } of candidates) {
    if (hits.length >= count) {
      skipped.push({ id: entry.id, reason: `top-k limit ${count} reached` });
      continue;
    }
    if (usedBytes + entry.sourceBytes > limit) {
      skipped.push({ id: entry.id, reason: `byte budget ${limit} exceeded` });
      continue;
    }
    usedBytes += entry.sourceBytes;
    hits.push({
      id: entry.id,
      rule: String(entry.rule || ''),
      reason: explain(entry, terms),
      path: entry.path,
      score,
      status: entry.status || 'unknown',
      verified: entry.metadata && validateCandidate(entry.metadataValue).valid
        && entry.verification?.status === 'passed',
      ...(entry.conflictsWith ? { conflictsWith: entry.conflictsWith } : {}),
      ...(entry.recheckAfter ? { recheckAfter: entry.recheckAfter } : {}),
    });
  }
  const boundedSkipped = boundSkipped(skipped, limit);
  const skippedBytes = Buffer.byteLength(JSON.stringify(boundedSkipped), 'utf8');
  const entryBytes = usedBytes;
  const contentBytes = entryBytes + skippedBytes;
  return {
    hits,
    skipped: boundedSkipped,
    budget: {
      limitBytes: limit,
      // usedBytes is the charged portion of hits plus the bounded skipped
      // summary; envelope metadata is reported separately.
      usedBytes: Math.min(limit, contentBytes),
      entryBytes,
      contentBytes,
      skippedBytes,
      metadataBytes: Buffer.byteLength(JSON.stringify({ hits: [], skipped: [], budget: { limitBytes: limit, usedBytes: 0 } }), 'utf8'),
      truncated: contentBytes > limit,
    },
  };
}

function nonNegativeInteger(value, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${field} must be a non-negative integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${field} is out of range`);
  return result;
}

function boundSkipped(items, limit) {
  const maxBytes = Math.max(96, Math.min(2048, limit || 256));
  const output = [];
  let bytes = 0;
  for (const item of items) {
    const next = {
      id: String(item.id || '').slice(0, 120),
      reason: String(item.reason || '').slice(0, 120),
    };
    const nextBytes = Buffer.byteLength(JSON.stringify(next), 'utf8') + (output.length ? 1 : 0);
    if (output.length >= 8 || bytes + nextBytes > maxBytes) break;
    output.push(next);
    bytes += nextBytes;
  }
  const remaining = items.length - output.length;
  if (remaining > 0) output.push({
    id: '__skipped__',
    count: remaining,
    summary: `${remaining} skipped entries omitted from the response summary`,
    truncated: true,
  });
  return output;
}

function stringField(value, field, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${field} must be a non-empty string`);
}

export function validateCandidate(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['candidate must be a JSON object'] };
  }
  for (const field of ['id', 'kind', 'scope', 'when', 'rule', 'avoid', 'status']) stringField(candidate[field], field, errors);
  if (!VALID_KINDS.has(candidate.kind)) errors.push('kind must be method or preference');
  if (!VALID_SCOPES.has(candidate.scope)) errors.push('scope must be project, global, or task');
  if (!VALID_STATUSES.has(candidate.status)) errors.push('status must be active, inactive, or superseded');
  if (!Array.isArray(candidate.signals)) errors.push('signals must be an array');
  if (!Array.isArray(candidate.evidenceRefs)) errors.push('evidenceRefs must be an array');
  if (candidate.kind === 'method') {
    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) errors.push('method requires evidenceRefs');
    if (!candidate.counterexample || typeof candidate.counterexample !== 'object') errors.push('method requires counterexample');
    else {
      stringField(candidate.counterexample.scenario, 'counterexample.scenario', errors);
      stringField(candidate.counterexample.outcome, 'counterexample.outcome', errors);
    }
    if (!candidate.verification || typeof candidate.verification !== 'object') errors.push('method requires verification');
    else {
      if (candidate.verification.status !== 'passed') errors.push('verification.status must be passed');
      stringField(candidate.verification.method, 'verification.method', errors);
      stringField(candidate.verification.evidenceRef, 'verification.evidenceRef', errors);
    }
  }
  return { valid: errors.length === 0, errors };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

function relation(candidate) {
  const values = [candidate.supersedes, candidate.supersedesId, candidate.supersedesIds]
    .flatMap(value => Array.isArray(value) ? value : value ? [value] : [])
    .map(String);
  return new Set(values);
}

function metadataLine(candidate) {
  return `<!-- harness-memory: ${JSON.stringify(candidate)} -->`;
}

function block(candidate) {
  const avoid = candidate.avoid ? ` Avoid: ${candidate.avoid}.` : '';
  const signals = candidate.signals?.length ? ` Signals: ${candidate.signals.join(', ')}.` : '';
  return `${metadataLine(candidate)}\n- When ${candidate.when}: ${candidate.rule}.${avoid}${signals}\n`;
}

function replaceMetadataAt(file, lineNumber, next) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) throw new Error(`Metadata line no longer exists: ${file}:${lineNumber}`);
  lines[index] = metadataLine(next);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function appendAtomic(file, text) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, current + prefix + text, 'utf8');
}

function allEntries(root) {
  const dirs = [scopedPath(root, path.join(root, 'Harness', 'memory'), { label: 'Harness/memory' })];
  return parseEntries(root, dirs.flatMap(dir => walkMarkdown(root, dir)));
}

export function applyCandidate({ root, globalRoot = null, candidate, apply = false }) {
  const validation = validateCandidate(candidate);
  if (!validation.valid) return { ok: false, errors: validation.errors, dryRun: !apply };
  const storageRoot = candidate.scope === 'global' ? scopedGlobalRoot(globalRoot, root) : root;
  if (!apply) return { ok: false, dryRun: true, errors: ['Dry run only. Re-run with --apply to write memory.'] };
  const memoryDir = scopedPath(storageRoot, path.join(storageRoot, 'Harness', 'memory'), { label: 'Memory storage' });
  const targetName = candidate.kind === 'preference' ? 'user-corrections-preferences.md' : 'agent-lessons-patterns.md';
  const target = scopedPath(storageRoot, path.join(memoryDir, targetName), { label: 'Memory target' });
  const entries = allEntries(storageRoot);
  const same = entries.find(entry => entry.id === candidate.id);
  if (same) {
    if (same.metadataValue && stable(same.metadataValue) === stable(candidate)) return { ok: true, action: 'duplicate', id: candidate.id, path: same.path };
    if (!relation(candidate).has(candidate.id)) {
      return { ok: false, errors: [`Conflict for memory id ${candidate.id}; provide an explicit supersedes relation.`] };
    }
    const next = { ...candidate };
    replaceMetadataAt(same.file, same.markerLine + 1, next);
    return { ok: true, action: 'updated', id: candidate.id, path: same.path };
  }
  const conflicts = entries.filter(entry => entry.metadata && entry.status !== 'superseded'
    && entry.when?.toLowerCase() === candidate.when.toLowerCase() && entry.rule !== candidate.rule);
  const supersedes = relation(candidate);
  const uncovered = conflicts.filter(entry => !supersedes.has(entry.id));
  if (uncovered.length) {
    return { ok: false, errors: [`Conflict with ${uncovered.map(entry => entry.id).join(', ')}; provide supersedes.`] };
  }
  for (const entry of conflicts.filter(item => supersedes.has(item.id))) {
    const next = { ...entry };
    delete next.file; delete next.raw; delete next.markerLine; delete next.line; delete next.path; delete next.metadata; delete next.sourceBytes; delete next.metadataValue;
    next.status = 'superseded';
    next.supersededBy = candidate.id;
    replaceMetadataAt(entry.file, entry.markerLine + 1, next);
  }
  appendAtomic(target, block(candidate));
  return { ok: true, action: 'created', id: candidate.id, path: safeRelative(storageRoot, target) };
}

export function setMemoryStatus({ root, id, status, supersededBy, apply = false }) {
  if (!id) return { ok: false, errors: ['--id is required'], dryRun: !apply };
  if (!VALID_STATUSES.has(status)) return { ok: false, errors: ['status must be inactive, superseded, or active'], dryRun: !apply };
  const entries = allEntries(root).filter(entry => entry.id === id);
  if (!entries.length) return { ok: false, errors: [`Memory id not found: ${id}`], dryRun: !apply };
  if (!apply) return { ok: false, dryRun: true, errors: ['Dry run only. Re-run with --apply to write memory.'] };
  for (const entry of entries) {
    const next = { ...entry };
    for (const field of ['file', 'raw', 'markerLine', 'line', 'path', 'metadata', 'sourceBytes', 'metadataValue']) delete next[field];
    next.status = status;
    if (status === 'superseded' && supersededBy) next.supersededBy = supersededBy;
    if (status === 'active') delete next.supersededBy;
    replaceMetadataAt(entry.file, entry.markerLine + 1, next);
  }
  return { ok: true, action: 'status-updated', id, status, count: entries.length };
}

export function writeFeedback({ root, taskId, entry, outcome, reason, apply = false }) {
  if (!taskId || !entry || !reason) return { ok: false, errors: ['--task, --entry, and --reason are required'], dryRun: !apply };
  if (!['useful', 'unused', 'incorrect'].includes(outcome)) return { ok: false, errors: ['outcome must be useful, unused, or incorrect'], dryRun: !apply };
  let taskDir;
  try { taskDir = scopedTaskDirectory(root, taskId); }
  catch (error) { return { ok: false, errors: [error.message], dryRun: !apply }; }
  const target = scopedPath(root, path.join(taskDir, 'evidence', 'memory-feedback.md'), { label: 'Feedback target' });
  if (!apply) return { ok: false, dryRun: true, errors: ['Dry run only. Re-run with --apply to write task-local evidence.'] };
  const safeReason = String(reason).replace(/[\r\n]+/g, ' ').trim();
  appendAtomic(target, `## Memory feedback: ${entry}\n- Outcome: ${outcome}\n- Reason: ${safeReason}\n`);
  return { ok: true, action: 'feedback-recorded', taskId, entry, path: safeRelative(root, target) };
}

export function readInput(value, root = null) { return readJsonInput(value, root); }
export { VALID_KINDS, VALID_SCOPES, VALID_STATUSES };
