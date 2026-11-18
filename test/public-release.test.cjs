'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const base = fs.mkdtempSync('D:/Multi-Agent/_runtime/public-scan-test-');
const checker = path.resolve(__dirname, '../tools/check-public.cjs');
let sequence = 0;
function fixture() {
  const root = path.join(base, String(++sequence)); fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.copyFileSync(checker, path.join(root, 'tools/check-public.cjs'));
  fs.writeFileSync(path.join(root, '.public-scan-allowlist.json'), '[]');
  return root;
}
function scan(root, args = []) {
  const p = cp.spawnSync(process.execPath, [path.join(root, 'tools/check-public.cjs'), ...args], { cwd: root, encoding: 'utf8' });
  return { status: p.status, output: p.stdout + p.stderr };
}
test.after(() => { assert.equal(path.resolve(path.dirname(base)), path.resolve('D:/Multi-Agent/_runtime')); fs.rmSync(base, { recursive: true, force: true }); });
test('public check accepts source and rejects a credential without echoing its value', () => {
  const root = fixture(); fs.writeFileSync(path.join(root, 'README.md'), '# Example\n'); assert.equal(scan(root).status, 0);
  const token = ['sk', 'proj', 'synthetic'.repeat(5)].join('-');
  fs.writeFileSync(path.join(root, 'example.ts'), `const key = '${token}';`);
  const result = scan(root); assert.equal(result.status, 1); assert.match(result.output, /provider-key/u); assert(!result.output.includes(token));
});
test('public check rejects runtime files, local environment and user paths', () => {
  for (const name of ['.env.local', 'cache.db', 'chat.jsonl']) { const root = fixture(); fs.writeFileSync(path.join(root, name), 'fixture only'); assert.equal(scan(root).status, 1); }
  if (process.env.USERPROFILE) { const root = fixture(); fs.writeFileSync(path.join(root, 'local.txt'), process.env.USERPROFILE); assert.match(scan(root).output, /current-user-path/u); }
});
test('public check distinguishes reserved/public endpoints from private connection literals', () => {
  const root = fixture(); const file = path.join(root, 'example.ts');
  fs.writeFileSync(file, "const p = {baseUrl: 'https://relay.invalid/v1'};"); assert.equal(scan(root).status, 0);
  const example = ['https:/', '/private-proxy.company-internal/v1'].join('');
  fs.writeFileSync(file, `const p = {baseUrl: '${example}'};`); assert.match(scan(root).output, /review-endpoint-literal/u);
});
test('public check rejects an escaping directory junction', () => {
  const root = fixture(); const outside = path.join(base, 'outside'); fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(scan(root).output, /symbolic-link/u);
});
test('public check checks staged content even if the working file was replaced', () => {
  const root = fixture(); cp.execFileSync('git', ['init', '-q'], { cwd: root });
  const token = ['sk', 'proj', 'only-for-release-check-tests'.repeat(2)].join('-');
  const file = path.join(root, 'example.ts'); fs.writeFileSync(file, `const key = '${token}';`);
  cp.execFileSync('git', ['add', '.'], { cwd: root }); fs.writeFileSync(file, 'const key = undefined;');
  assert.equal(scan(root).status, 0); const result = scan(root, ['--staged']); assert.equal(result.status, 1); assert(!result.output.includes(token));
});
test('public check catches missing local documentation links', () => {
  const root = fixture(); fs.writeFileSync(path.join(root, 'README.md'), '[Missing](docs/no-file.md)'); assert.match(scan(root).output, /missing-local-link/u);
});
