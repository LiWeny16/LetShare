#!/usr/bin/env node
import { decide, projectRoot, readInput, recordReference } from './lib/research-policy.mjs';

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
function finish(payload, code = 0) { process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`); process.exitCode = code; }
try {
  const { command, options } = parse(process.argv.slice(2));
  if (command === 'decide') finish({ ok: true, command, ...decide({ trigger: options.trigger, taskType: options['task-type'] || 'chore' }) });
  else if (command === 'record') { const root = projectRoot(options.project); const result = recordReference({ root, taskId: options.task, reference: readInput(options.input, root), apply: options.apply === true }); finish({ command, ...result }, result.ok ? 0 : 1); }
  else if (!command || options.help) finish({ ok: true, commands: ['decide', 'record'] });
  else finish({ ok: false, command, errors: [`Unknown command: ${command}`] }, 1);
} catch (error) { finish({ ok: false, errors: [error.message] }, 1); }
