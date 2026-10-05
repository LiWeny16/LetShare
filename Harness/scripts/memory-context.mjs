#!/usr/bin/env node
import {
  applyCandidate,
  projectRoot,
  queryMemory,
  readInput,
  setMemoryStatus,
  validateCandidate,
  writeFeedback,
} from './lib/memory-context.mjs';

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'apply' || key === 'json') options[key] = true;
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) {
      const value = rest[++i];
      options[key] = options[key] === undefined ? value : [...(Array.isArray(options[key]) ? options[key] : [options[key]]), value];
    }
    else options[key] = true;
  }
  return { command, options };
}

function finish(payload, code = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = code;
}

try {
  const { command, options } = parse(process.argv.slice(2));
  if (!command || options.help) {
    finish({ ok: true, commands: ['query', 'validate', 'apply', 'set-status', 'feedback'] });
  } else if (command === 'query') {
    const root = projectRoot(options.project);
    finish({ ok: true, command, ...queryMemory({ root, globalRoot: options['global-root'], text: options.text, scope: options.scope || 'project', taskId: options.task, topK: options['top-k'], budgetBytes: options['budget-bytes'] }) });
  } else if (command === 'validate') {
    const root = projectRoot(options.project);
    const candidate = readInput(options.input, root);
    const result = validateCandidate(candidate);
    finish({ ok: result.valid, command, ...result }, result.valid ? 0 : 1);
  } else if (command === 'apply') {
    const root = projectRoot(options.project);
    const result = applyCandidate({ root, globalRoot: options['global-root'], candidate: readInput(options.input, root), apply: options.apply === true });
    finish({ command, ...result }, result.ok ? 0 : 1);
  } else if (command === 'set-status') {
    const root = projectRoot(options.project);
    const result = setMemoryStatus({ root, id: options.id, status: options.status, supersededBy: options['superseded-by'], apply: options.apply === true });
    finish({ command, ...result }, result.ok ? 0 : 1);
  } else if (command === 'feedback') {
    const root = projectRoot(options.project);
    const result = writeFeedback({ root, taskId: options.task, entry: options.entry, outcome: options.outcome, reason: options.reason, apply: options.apply === true });
    finish({ command, ...result }, result.ok ? 0 : 1);
  } else {
    finish({ ok: false, command, errors: [`Unknown command: ${command}`] }, 1);
  }
} catch (error) {
  finish({ ok: false, errors: [error.message] }, 1);
}
