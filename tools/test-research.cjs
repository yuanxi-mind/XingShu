'use strict';
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = readdirSync(path.join(root, 'test')).filter(name =>
  /^(?:research.*|api-collab.*|agent-appearance|chat-state|ui-preferences|project-workspaces)\.test\.cjs$/u.test(name)
).sort().map(name => path.join('test', name));
if (!files.length) throw new Error('No research tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
