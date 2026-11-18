'use strict';
// A conservative release check, not a proof that arbitrary content is public.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const staged = process.argv.includes('--staged');
const ignored = new Set(['.git', 'node_modules', 'out', 'dist', 'coverage', '.vite']);
const forbiddenParts = /^(?:_runtime|_secrets|WorkGroup|AgentChats|tasks|runs|\.ssh|\.worktrees|\.gstack)$/iu;
const forbiddenName = /^(?:\.env(?:\..+)?|\.npmrc|api-providers\.json|credentials\.json|secrets\.json|project\.json|PROJECT_CONTEXT\.md|项目上下文\.md|研究项目上下文\.md|IMPLEMENTATION_.+|id_(?:rsa|ed25519).*)$/iu;
const forbiddenExt = /\.(?:db(?:-.*)?|sqlite\d*|jsonl|log|dmp|pem|key|p8|p12|pfx|cer|exe|asar|zip|tar|gz|bak|backup)$/iu;
const issues = [];
const contents = new Map();
// Exact, file-scoped fingerprints of reviewed synthetic regression examples.
const allowlist = JSON.parse(staged ? cp.execFileSync('git', ['show', ':.public-scan-allowlist.json'], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, '.public-scan-allowlist.json'), 'utf8'));
const synthetic = new Set(allowlist.map(item => `${item.file}:${item.rule}:${item.sha256}`));
let syntheticCount = 0;
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { issues.push({ file: path.relative(root, file), rule: 'symbolic-link' }); return []; }
    return entry.isDirectory() ? files(file) : [path.relative(root, file).replaceAll('\\', '/')];
  });
}
const entries = staged ? cp.execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map(entry => {
  const tab = entry.indexOf('\t'); const [mode, oid, stage] = entry.slice(0, tab).split(' ');
  if (stage !== '0') throw new Error('Resolve Git conflicts before checking public files');
  return { file: entry.slice(tab + 1), mode, oid };
}) : [];
const modes = new Map(entries.map(entry => [entry.file, entry.mode]));
const indexed = new Map();
if (entries.length) {
  // One batch avoids starting git twice for every file during each commit.
  const batch = cp.execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: entries.map(entry => entry.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024 });
  let offset = 0;
  for (const entry of entries) {
    const end = batch.indexOf(10, offset); const header = batch.toString('ascii', offset, end).split(' '); const size = Number(header[2]);
    if (end < 0 || !Number.isSafeInteger(size) || size < 0 || end + size + 2 > batch.length) throw new Error('Cannot read staged object');
    indexed.set(entry.file, batch.subarray(end + 1, end + 1 + size)); offset = end + size + 2;
  }
}
const list = staged ? entries.map(entry => entry.file) : files(root);
const patterns = [
  ['provider-key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/gu],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})\b/gu],
  ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{30,}\b/gu],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ['url-credentials', /https?:\/\/[^\s/"'<>:@]+:[^\s/"'<>@]+@/gu],
  ['private-key-block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}/gu]
];
const profiles = [process.env.USERPROFILE, process.env.HOMEPATH].filter(value => value && value.length > 5);
const personal = [...new Set(profiles.flatMap(value => [value, path.basename(value)]).filter(value => value.length >= 2))];
for (const rel of list) {
  const parts = rel.split('/');
  if (parts.some(part => forbiddenParts.test(part)) || (forbiddenName.test(parts.at(-1)) && parts.at(-1) !== '.env.example') || forbiddenExt.test(rel)) {
    issues.push({ file: rel, rule: 'private-or-generated-path' }); continue;
  }
  if (staged) {
    if (['120000', '160000'].includes(modes.get(rel))) { issues.push({ file: rel, rule: 'link-or-submodule' }); continue; }
  }
  const bytes = staged ? indexed.get(rel) : fs.readFileSync(path.join(root, rel));
  if (bytes.length > 12 * 1024 * 1024) issues.push({ file: rel, rule: 'unexpected-large-file' });
  const binary = /\.(?:png|jpg|jpeg|webp|gif|ico|woff2|ttf)$/iu.test(rel);
  if (binary) continue;
  const value = bytes.toString('utf8'); contents.set(rel, value);
  const line = index => value.slice(0, index).split('\n').length;
  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const hit of value.matchAll(pattern)) {
      const signature = `${rel}:${rule}:${crypto.createHash('sha256').update(hit[0]).digest('hex')}`;
      if (synthetic.has(signature)) syntheticCount++;
      else issues.push({ file: rel, line: line(hit.index), rule });
    }
  }
  for (const profile of personal) {
    const variants = [profile, profile.replaceAll('\\', '/'), profile.replaceAll('\\', '\\\\')];
    if (variants.some(p => value.toLowerCase().includes(p.toLowerCase()))) issues.push({ file: rel, rule: 'current-user-path' });
  }
  // Endpoint literals in examples must be public API hosts or reserved examples.
  for (const m of value.matchAll(/\bbaseUrl\s*:\s*['"](https?:\/\/[^'"\s]+)['"]/gu)) {
    try {
      const host = new URL(m[1]).hostname;
      if (!/(?:^|\.)(?:invalid|example|test|example\.com|example\.org|example\.net)$/iu.test(host) && !['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.github.com', 'api.linear.app', 'your-domain.atlassian.net', 'api.notion.com', 'api.stripe.com', 'sentry.io', 'api.hubapi.com', 'localhost', '127.0.0.1'].includes(host)) issues.push({ file: rel, line: line(m.index), rule: 'review-endpoint-literal' });
    } catch { issues.push({ file: rel, line: line(m.index), rule: 'invalid-endpoint-literal' }); }
  }
}
for (const [rel, value] of contents) {
  if (!rel.endsWith('.md') || rel.startsWith('src/') || rel.startsWith('resources/')) continue;
  for (const m of value.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)) {
    const target = m[1];
    if (/^(?:https?:|mailto:|#)/iu.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(rel), decodeURIComponent(target.split('#')[0]));
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) issues.push({ file: rel, rule: 'missing-local-link' });
  }
}
if (issues.length) { console.error(JSON.stringify({ ok: false, mode: staged ? 'index' : 'working-tree', issues }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, mode: staged ? 'index' : 'working-tree', files: list.length, reviewedSyntheticMatches: syntheticCount, note: 'Pattern check passed; manual file and screenshot review is still required.' }));
