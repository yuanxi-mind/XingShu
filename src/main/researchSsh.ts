import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { ExperimentBundle, ResearchServer } from '../shared/researchIntelligence';
import { researchAtomicJson as atomic, researchSafePath as safe } from './researchWorkspace';

const exec = promisify(execFile);
const quote = (s: string): string => "'" + s.replaceAll("'", "'\\''") + "'";
const py = (code: string): string => `python3 -c ${quote(code)}`;
const fingerprint = (s: ResearchServer): string => createHash('sha256').update(JSON.stringify(s)).digest('hex');
export function validateResearchServer(s: ResearchServer): ResearchServer {
  if (!s || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/u.test(s.host) || !Number.isSafeInteger(s.port) || s.port < 1 || s.port > 65535 || !/^[a-z_][a-zA-Z0-9_-]{0,31}$/u.test(s.username) || s.username === 'root') throw new Error('请填写有效的SSH主机、端口和非root用户');
  if (typeof s.identityFile !== 'string' || !/^[Dd]:[\\/]/u.test(s.identityFile) || !existsSync(s.identityFile) || lstatSync(s.identityFile).isSymbolicLink() || !statSync(s.identityFile).isFile() || statSync(s.identityFile).size > 1_000_000) throw new Error('SSH仅使用你选定的D盘私钥文件；不保存密码，也不向Agent开放私钥');
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/u.test(s.hostFingerprint)) throw new Error('请填写向服务器管理员核实的SHA256主机指纹，不能盲目接受未知主机');
  for (const p of [s.remoteRoot, s.datasetRoot].filter(Boolean)) if (typeof p !== 'string' || !/^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u.test(p) || p.split('/').some(x => x === '..' || x === '.') || p === '/' || p.length > 400) throw new Error('服务器目录须为绝对Linux路径，只使用字母、数字、下划线、点和短横线');
  if (!s.remoteRoot || typeof s.datasetRoot !== 'string') throw new Error('请填写服务器实验根目录；数据集目录可以留空');
  return { host: s.host, port: s.port, username: s.username, identityFile: s.identityFile, hostFingerprint: s.hostFingerprint, remoteRoot: s.remoteRoot, datasetRoot: s.datasetRoot };
}
export class ResearchSshTransport {
  constructor(private readonly root: string) {}
  server(): ResearchServer | null { const file = safe(this.root, 'runs/remote-experiment/server.json'); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as ResearchServer : null; }
  saveServer(s: ResearchServer): void { atomic(safe(this.root, 'runs/remote-experiment/server.json', true), validateResearchServer(s)); }
  configurationHash(): string { return fingerprint(this.checked()); }
  private checked(bundle?: ExperimentBundle): ResearchServer {
    const s = this.server(); if (!s) throw new Error('请先配置本项目的服务器连接'); const checked = validateResearchServer(s);
    if (bundle?.serverHash && fingerprint(checked) !== bundle.serverHash) throw new Error('服务器配置已变化；请恢复本实验提交时的连接，避免操作另一台服务器'); return checked;
  }
  private async request(s: ResearchServer, command: string, archive?: string): Promise<string> {
    const config = safe(this.root, 'runs/remote-experiment/ssh-config', true); if (!existsSync(config)) writeFileSync(config, '# Project-isolated SSH configuration\n', { flag: 'wx' });
    const known = safe(this.root, 'runs/remote-experiment/known_hosts', true); if (!existsSync(known)) throw new Error('请先核验服务器指纹并测试连接');
    const args = ['-F', config, '-o', 'BatchMode=yes', '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=10', '-o', `UserKnownHostsFile=${known}`, '-o', 'GlobalKnownHostsFile=NUL', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-p', String(s.port), '-i', s.identityFile, `${s.username}@${s.host}`, command];
    return new Promise((resolve, reject) => {
      const child = spawn('ssh', args, { windowsHide: true, cwd: dirname(config), env: { ...process.env, TEMP: process.env.TEMP, TMP: process.env.TMP }, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; let error = ''; let failed = false;
      const fail = (message: string): void => { if (failed) return; failed = true; child.kill(); reject(new Error(message)); };
      const timer = setTimeout(() => fail('SSH连接超时；提交状态可能未知，请查询后再操作'), archive ? 300000 : 45000);
      child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); if (out.length > 16_000_000) fail('SSH结果超过16MB，已停止接收'); });
      child.stderr.on('data', (b: Buffer) => { error = (error + b.toString('utf8')).slice(-2000); });
      child.on('error', () => fail('无法启动系统SSH，请确认Windows已安装OpenSSH客户端'));
      child.stdin.on('error', () => { /* An early remote exit is reported by the process close event. */ });
      child.on('close', code => { clearTimeout(timer); if (!failed) code === 0 ? resolve(out.trim()) : reject(new Error(`SSH失败（${code}）：${error.slice(-600)}`)); });
      if (archive) { const stream = createReadStream(archive); stream.on('error', () => fail('无法读取D盘实验包')); child.on('close', () => stream.destroy()); stream.pipe(child.stdin); } else child.stdin.end();
    });
  }
  async verify(): Promise<string> {
    const s = this.checked();
    const scan = await exec('ssh-keyscan', ['-T', '8', '-p', String(s.port), s.host], { windowsHide: true, timeout: 20000, maxBuffer: 100000, cwd: this.root });
    const matches = scan.stdout.split(/\r?\n/u).filter(line => {
      const parts = line.trim().split(/\s+/u); if (parts.length !== 3 || parts[0].startsWith('#')) return false;
      return 'SHA256:' + createHash('sha256').update(Buffer.from(parts[2], 'base64')).digest('base64').replace(/=+$/u, '') === s.hostFingerprint;
    });
    if (!matches.length) throw new Error('服务器返回的公钥与指定指纹不一致，拒绝连接');
    const host = s.port === 22 ? s.host : `[${s.host}]:${s.port}`;
    writeFileSync(safe(this.root, 'runs/remote-experiment/known_hosts', true), matches.map(line => `${host} ${line.trim().split(/\s+/u).slice(1).join(' ')}`).join('\n') + '\n');
    const result = await this.request(s, py("import json,subprocess,sys; p=subprocess.run(['docker','info','--format','{{.ServerVersion}}'],capture_output=True,text=True,timeout=20); print(json.dumps({'python':sys.version.split()[0],'docker':p.stdout.strip(),'ready':p.returncode==0})); sys.exit(0 if p.returncode==0 else 1)"));
    return `主机指纹匹配，已验证Python/Docker可访问；没有提交训练。${result}`;
  }
  async submit(b: ExperimentBundle, archive: string): Promise<{ directory: string; serverHash: string; note: string }> {
    const s = this.checked(); const directory = `${s.remoteRoot}/${b.id}`;
    const result = { directory, serverHash: fingerprint(s), note: '已提交；请查询状态。不会因断线自动重提。' };
    const runner = ['python3', 'run_experiment.py', '--manifest-sha256', b.manifestHash, ...(s.datasetRoot ? ['--dataset-root', s.datasetRoot] : [])].map(quote).join(' ');
    const command = `set -eu; umask 077; mkdir -p -- ${quote(s.remoteRoot)}; test "$(realpath -- ${quote(s.remoteRoot)})" = ${quote(s.remoteRoot)}; mkdir -- ${quote(directory)}; cd -- ${quote(directory)}; tar --no-same-owner --no-same-permissions -xzf -; nohup ${runner} > launcher.log 2>&1 < /dev/null & child=$!; printf '%s\n' "$child" > runner.pid; printf '%s\n' ${quote(JSON.stringify(result))}`;
    await this.request(s, command, archive); return result;
  }
  async status(b: ExperimentBundle): Promise<{ status: ExperimentBundle['status']; note: string }> {
    if (!b.approvedAt) throw new Error('此实验包未由你批准提交');
    const s = this.checked(b); const directory = `${s.remoteRoot}/${b.id}`;
    const code = `import pathlib,json,os\np=pathlib.Path(${JSON.stringify(directory)})\nf=p/'results/bundle-results.json'\nif f.is_file():\n d=json.loads(f.read_text()); assert d.get('bundleId')==${JSON.stringify(b.id)} and d.get('manifestHash')==${JSON.stringify(b.manifestHash)}\n status=d['status']; note=d.get('error','服务器状态已读取')\n if status=='running':\n  pidfile=p/'runner.pid'; pid=pidfile.read_text().strip() if pidfile.is_file() else ''\n  cmd=pathlib.Path('/proc')/pid/'cmdline'\n  if not pid.isdigit() or not cmd.is_file() or ${JSON.stringify(b.manifestHash)}.encode() not in cmd.read_bytes():\n   status='unknown'; note='状态文件仍为运行中，但未找到本实验进程；请核对服务器，不自动重提'\n print(json.dumps({'status':status,'note':note}))\nelse:\n print(json.dumps({'status':'unknown','note':'尚无完整状态文件；不自动重复提交，请检查服务器目录'}))`;
    const result = JSON.parse(await this.request(s, py(code))) as { status: string; note: string };
    if (!['running', 'completed', 'failed', 'cancelled', 'unknown'].includes(result.status)) throw new Error('服务器状态无效');
    return result as { status: ExperimentBundle['status']; note: string };
  }
  async cancel(b: ExperimentBundle): Promise<void> {
    const s = this.checked(b); const directory = `${s.remoteRoot}/${b.id}`;
    const code = `import pathlib,os,signal,subprocess\np=pathlib.Path(${JSON.stringify(directory)})\nf=p/'runner.pid'\nif f.is_file():\n text=f.read_text().strip(); assert text.isdigit(); pid=int(text)\n cmd=pathlib.Path('/proc')/str(pid)/'cmdline'\n if cmd.is_file() and ${JSON.stringify(b.manifestHash)}.encode() in cmd.read_bytes(): os.kill(pid,signal.SIGTERM)\nfor seed in ${JSON.stringify(b.plan.seeds)}:\n subprocess.run(['docker','stop','--time','5',${JSON.stringify('xingshu-' + b.id.slice(-12) + '-')}+str(seed)],capture_output=True,timeout=15)\nprint('已发送停止信号；请查询最终状态')`;
    await this.request(s, py(code));
  }
  async collect(b: ExperimentBundle): Promise<Record<string, string>> {
    if (!b.approvedAt) throw new Error('此实验包未由你批准提交');
    const s = this.checked(b); const directory = `${s.remoteRoot}/${b.id}`;
    const code = `import pathlib,json,base64\np=pathlib.Path(${JSON.stringify(directory)}).resolve()\nfiles=['results/bundle-results.json']+[f'results/seed-{s}/{n}' for s in ${JSON.stringify(b.plan.seeds)} for n in ['train.log','metrics.json']]\nout={}\nfor name in files:\n f=p/name\n if f.is_file():\n  assert not f.is_symlink() and p in f.resolve().parents and f.stat().st_size<1500000\n  out[name]=base64.b64encode(f.read_bytes()).decode()\nprint(json.dumps(out))`;
    return JSON.parse(await this.request(s, py(code))) as Record<string, string>;
  }
}
