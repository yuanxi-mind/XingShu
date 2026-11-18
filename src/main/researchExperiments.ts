import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { ClaimCheck, ExperimentBundle, ExperimentClaim, ExperimentClaimInput, ExperimentClaimPair, ExperimentClaimResult, ExperimentPlan, ExperimentSnapshot, LockedClaimPair, ResearchServer } from '../shared/researchIntelligence';
import { EXPERIMENT_RUNNER } from './experimentRunner';
import { ResearchWorkspaceStore, researchAtomicJson as atomic, researchCopyTree as copy, researchFileManifest as manifest, researchManifestHash as digest, researchSafePath as safe } from './researchWorkspace';
import { ResearchSshTransport } from './researchSsh';

const sha = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');
const now = (): string => new Date().toISOString();
const ID = /^bundle-[a-f0-9-]{36}$/u;
const shaFile = async (file: string): Promise<string> => { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b as Buffer); return h.digest('hex'); };
function relativeFile(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 240 || !value || value.split('/').some(p => !/^[\p{L}\p{N}_. -]+$/u.test(p) || p === '.' || p === '..' || /[. ]$/u.test(p))) throw new Error(`${label}须为安全的相对文件路径`);
  return value;
}
export function validateExperimentPlan(p: ExperimentPlan): ExperimentPlan {
  if (!p || !Array.isArray(p.args) || p.args.length > 60 || p.args.some(a => typeof a !== 'string' || a.length > 1000 || /[\u0000-\u001f]/u.test(a))) throw new Error('训练参数须为最多60个字符串，不支持换行或控制字符');
  if (!Array.isArray(p.seeds) || !p.seeds.length || p.seeds.length > 5 || new Set(p.seeds).size !== p.seeds.length || p.seeds.some(s => !Number.isSafeInteger(s) || s < 0 || s > 2147483647)) throw new Error('请填写1–5个不重复的非负整数seed');
  if (typeof p.seedFlag !== 'string' || (p.seedFlag !== '' && !/^--?[a-zA-Z][a-zA-Z0-9_-]*$/u.test(p.seedFlag))) throw new Error('seed参数须为--seed这类选项，或留空使用RESEARCH_SEED环境变量');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*@sha256:[a-f0-9]{64}$/u.test(p.image)) throw new Error('请填写服务器已安装的Docker镜像完整digest（镜像名@sha256:64位校验值）');
  for (const [n, min, max] of [[p.timeoutSeconds, 10, 86400], [p.cpus, 1, 128], [p.memoryGb, 1, 1024]] as const) if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('每seed时长须为10–86400秒，CPU为1–128核，内存为1–1024GB');
  if (typeof p.gpuDevices !== 'string' || (p.gpuDevices && !/^\d+(?:,\d+)*$/u.test(p.gpuDevices))) throw new Error('GPU须为设备编号，如0；不使用GPU请留空');
  if ([p.dataset, p.split, p.metricName].some(v => typeof v !== 'string' || !v.trim() || v.length > 200)) throw new Error('数据集、划分标识、指标名称均须填写，最多200字符');
  if (p.metricUnit && !['percent', 'fraction', 'number'].includes(p.metricUnit)) throw new Error('指标单位无效');
  return { ...p, metricUnit: p.metricUnit ?? 'percent', args: [...p.args], seeds: [...p.seeds], entrypoint: relativeFile(p.entrypoint, '训练入口'), dependencyFile: relativeFile(p.dependencyFile, '依赖文件'), metricPath: relativeFile(p.metricPath, '指标文件'), ...(p.splitManifest ? { splitManifest: relativeFile(p.splitManifest, '划分清单') } : {}) };
}
function configurationDifferences(a: ExperimentBundle, b: ExperimentBundle): string[] {
  const reasons: string[] = [];
  if (!a.splitHash || a.splitHash !== b.splitHash) reasons.push('缺少相同的划分清单哈希');
  if (!a.dependencyHash || a.dependencyHash !== b.dependencyHash) reasons.push('依赖文件哈希不一致');
  for (const field of ['dataset', 'split', 'seeds', 'seedFlag', 'image', 'metricName', 'metricUnit', 'metricPath', 'entrypoint', 'args', 'dependencyFile', 'splitManifest', 'timeoutSeconds', 'cpus', 'memoryGb', 'gpuDevices'] as const) if (JSON.stringify(a.plan[field]) !== JSON.stringify(b.plan[field])) reasons.push(`${field}不一致`);
  return reasons;
}
const claimBundleHash = (b: ExperimentBundle): string => sha(JSON.stringify([b.id, b.proposalId, b.codeHash, b.manifestHash, b.archiveHash, b.dependencyHash, b.splitHash, b.plan]));
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512); let leaf = name; let prefix = '';
  if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf('/'); prefix = name.slice(0, cut); leaf = name.slice(cut + 1); }
  if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('实验包存在过长文件路径，请缩短后重建');
  header.write(leaf, 0, 100); header.write('0000644\0', 100, 8); header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8);
  const oct = size.toString(8); if (oct.length > 11) throw new Error('实验包单个文件过大');
  header.write(oct.padStart(11, '0') + '\0', 124, 12); header.write('00000000000\0', 136, 12); header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155);
  header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8); return header;
}
export class ResearchExperiments {
  private readonly transport: ResearchSshTransport;
  private readonly busy = new Set<string>();
  constructor(private readonly store: ResearchWorkspaceStore) { this.transport = new ResearchSshTransport(store.root); }
  private file(id: string, suffix = 'bundle.json'): string { if (!ID.test(id)) throw new Error('实验包ID无效'); return safe(this.store.root, `runs/experiment-bundles/${id}/${suffix}`, true); }
  private read(id: string): ExperimentBundle { const b = JSON.parse(readFileSync(this.file(id), 'utf8')) as ExperimentBundle; if (b.id !== id) throw new Error('实验包状态损坏'); return b; }
  snapshot(): ExperimentSnapshot {
    const index = safe(this.store.root, 'runs/experiment-bundles/index.json');
    const ids: string[] = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) as string[] : [];
    if (!Array.isArray(ids) || ids.length > 1000) throw new Error('实验包索引损坏');
    return { server: this.transport.server(), bundles: ids.slice(-60).reverse().map(id => this.read(id)), claims: this.claims().slice().reverse() };
  }
  private save(b: ExperimentBundle): void { atomic(this.file(b.id), b); }
  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new Error('该实验操作正在进行，请等待当前操作完成');
    this.busy.add(key); try { return await work(); } finally { this.busy.delete(key); }
  }
  async prepare(proposalId: string, raw: ExperimentPlan): Promise<ExperimentBundle> {
    return this.exclusive('prepare', () => this.prepareBundle(proposalId, raw));
  }
  private async prepareBundle(proposalId: string, raw: ExperimentPlan): Promise<ExperimentBundle> {
    const plan = validateExperimentPlan(raw); const p = this.store.snapshot().proposals.find(q => q.id === proposalId);
    const baseline = proposalId === '__baseline__' ? this.store.snapshot().versions.find(v => v.id === this.store.snapshot().currentVersionId) : undefined;
    if (baseline) this.store.assertVersion(baseline);
    if (!baseline && (!p?.approval || p.publishedVersionId || !p.reviews.at(-1)?.passed || p.reviews.at(-1)?.codeHash !== this.store.codeHash(proposalId) || p.implementationHash !== this.store.codeHash(proposalId))) throw new Error('请先完成并通过对应代码核查，再生成实验包');
    const source = baseline?.codeRef ?? p!.approval!.workspaceRef;
    const hash = digest(manifest(safe(this.store.root, source)));
    for (const file of [plan.entrypoint, plan.dependencyFile, ...(plan.splitManifest ? [plan.splitManifest] : [])]) if (!existsSync(safe(this.store.root, `${source}/${file}`))) throw new Error(`代码中缺少 ${file}`);
    const id = 'bundle-' + randomUUID(); const reference = `runs/experiment-bundles/${id}/package`; const root = dirname(this.file(id, 'package/.stage'));
    copy(safe(this.store.root, source), join(root, 'code'));
    if (digest(manifest(join(root, 'code'))) !== hash || digest(manifest(safe(this.store.root, source))) !== hash) throw new Error('复制期间代码发生变化，未生成有效实验包');
    const codeFiles = manifest(join(root, 'code'));
    if (Object.keys(codeFiles).some(p => /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519)$|\.(?:p12|pfx|pem)$/iu.test(p))) throw new Error('代码副本含常见凭据文件，已停止打包；请先检查并移除敏感文件，再核查代码');
    atomic(join(root, 'experiment.json'), plan); writeFileSync(join(root, 'run_experiment.py'), EXPERIMENT_RUNNER, { flag: 'wx' });
    const files = manifest(root); const mf = { schemaVersion: 1, runner: 'xingshu-experiment-v1', bundleId: id, proposalId, codeHash: hash, files };
    atomic(join(root, 'manifest.json'), mf); const manifestHash = sha(readFileSync(join(root, 'manifest.json')));
    writeFileSync(join(root, 'README.txt'), `星枢可复现实验包\n代码：${hash}\n清单：${manifestHash}\n\nLinux服务器需预装Python3、Docker和指定digest镜像。镜像依赖须与${plan.dependencyFile}一致；本程序不会联网安装依赖。\n核验：python3 run_experiment.py --manifest-sha256 ${manifestHash} --check-only\n运行：python3 run_experiment.py --manifest-sha256 ${manifestHash} --dataset-root /你的/数据集目录\n结果：results/bundle-results.json；请连同results下的日志和metrics文件一起带回。\n数据集只读映射到容器/datasets，代码隔离到每个seed的/workspace；训练需将JSON数字指标${plan.metricName}写到${plan.metricPath}。\n首次运行后不能重复启动同一实验包，重复实验请新建包。禁止将程序生成的核验记录当作独立第三方真实性证明。\n`, { flag: 'wx' });
    const packageFiles = Object.keys(manifest(root)); const archive = this.file(id, 'experiment.tar.gz'); const temp = archive + '.tmp';
    async function* tar(): AsyncGenerator<Buffer> { for (const name of packageFiles) { const source = safe(root, name); const size = statSync(source).size; yield tarHeader(name, size); for await (const data of createReadStream(source)) yield data as Buffer; const padding = (512 - size % 512) % 512; if (padding) yield Buffer.alloc(padding); } yield Buffer.alloc(1024); }
    await pipeline(Readable.from(tar()), createGzip(), createWriteStream(temp, { flags: 'wx' })); renameSync(temp, archive);
    const bundle: ExperimentBundle = { id, proposalId: baseline ? `baseline:${baseline.id}` : proposalId, codeHash: hash, manifestHash, plan, reference, dependencyHash: codeFiles[plan.dependencyFile], ...(plan.splitManifest ? { splitHash: codeFiles[plan.splitManifest] } : {}), archiveReference: `runs/experiment-bundles/${id}/experiment.tar.gz`, createdAt: now(), status: 'prepared' };
    bundle.archiveHash = await shaFile(archive);
    this.save(bundle); const index = safe(this.store.root, 'runs/experiment-bundles/index.json', true); const ids = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) as string[] : [];
    atomic(index, [...ids, id]); return bundle;
  }
  saveServer(server: ResearchServer): void { this.transport.saveServer(server); }
  async verifyServer(): Promise<string> { return this.transport.verify(); }
  async submit(id: string, consent: boolean): Promise<ExperimentBundle> {
    return this.exclusive(id, () => this.submitBundle(id, consent));
  }
  private async submitBundle(id: string, consent: boolean): Promise<ExperimentBundle> {
    if (consent !== true) throw new Error('提交训练必须由你确认资源和运行次数');
    const b = this.read(id); if (b.status !== 'prepared') throw new Error('此实验包已提交或状态不确定，禁止重复提交；请先查询服务器状态');
    if (!b.archiveHash || await shaFile(safe(this.store.root, b.archiveReference)) !== b.archiveHash) throw new Error('实验压缩包已变化，禁止提交');
    if (!b.proposalId.startsWith('baseline:') && this.store.codeHash(b.proposalId) !== b.codeHash) throw new Error('工作副本已更新，请重新核查并生成新实验包');
    b.serverHash = this.transport.configurationHash(); b.approvedAt = now(); b.status = 'unknown'; b.note = '提交中；连接中断时先查询，不自动重放训练。'; this.save(b);
    try { const result = await this.transport.submit(b, safe(this.store.root, b.archiveReference)); b.status = 'submitted'; b.remoteDirectory = result.directory; b.serverHash = result.serverHash; b.note = result.note; }
    catch (error) { b.note = error instanceof Error ? error.message : 'SSH提交失败，可能已启动；先查询状态'; }
    this.save(b); return b;
  }
  async refresh(id: string): Promise<ExperimentBundle> {
    return this.exclusive(id, () => this.refreshBundle(id));
  }
  private async refreshBundle(id: string): Promise<ExperimentBundle> {
    const b = this.read(id); const remote = await this.transport.status(b); if (!b.results) b.status = remote.status;
    b.note = b.results ? `结果已登记，服务器查询：${remote.note}` : remote.note; this.save(b); return b;
  }
  async cancel(id: string, consent: boolean): Promise<ExperimentBundle> {
    return this.exclusive(id, async () => {
    if (!consent) throw new Error('停止服务器实验需要你确认');
    const b = this.read(id); if (!b.approvedAt) throw new Error('此实验包没有服务器提交记录');
    await this.transport.cancel(b); return this.refreshBundle(id);
    });
  }
  async collect(id: string): Promise<ExperimentBundle> {
    return this.exclusive(id, async () => {
    const b = this.read(id); if (!b.approvedAt) throw new Error('此实验包没有服务器提交记录');
    if (b.results) throw new Error('这份结果已经登记，不能重复收回');
    const result = await this.transport.collect(b);
    const directory = dirname(this.file(id, 'collected/.stage'));
    for (const [name, encoded] of Object.entries(result)) {
      if (!/^results\/(?:bundle-results\.json|seed-\d+\/(?:train\.log|metrics\.json))$/u.test(name) || typeof encoded !== 'string' || encoded.length > 2_000_000) throw new Error('服务器返回不允许的结果文件');
      const value = Buffer.from(encoded, 'base64'); if (value.toString('base64') !== encoded) throw new Error('服务器结果编码无效');
      writeFileSync(safe(directory, name, true), value);
    }
    return this.importBundleResult(id, safe(directory, 'results/bundle-results.json'));
    });
  }
  importResult(id: string, file: string): ExperimentBundle {
    if (this.busy.has(id)) throw new Error('该实验操作正在进行，请等待当前操作完成');
    return this.importBundleResult(id, file);
  }
  private importBundleResult(id: string, file: string): ExperimentBundle {
    const b = this.read(id); if (b.results || b.experimentId) throw new Error('这份结果已经登记，不能重复导入');
    if (statSync(file).size > 2_000_000) throw new Error('实验结果描述文件过大');
    const data = JSON.parse(readFileSync(file, 'utf8')) as { runner: string; bundleId: string; manifestHash: string; codeHash: string; plan: ExperimentPlan; status: string; runs: Array<{ seed: number; metric?: number; exitCode: number | null; log: string; logHash: string; metrics?: string; metricsHash?: string }> };
    if (data.runner !== 'xingshu-experiment-v1' || data.bundleId !== id || data.manifestHash !== b.manifestHash || data.codeHash !== b.codeHash || JSON.stringify(data.plan) !== JSON.stringify(b.plan) || !['completed', 'failed', 'cancelled'].includes(data.status) || !Array.isArray(data.runs) || data.runs.length > b.plan.seeds.length || new Set(data.runs.map(r => r.seed)).size !== data.runs.length || data.runs.some(r => !b.plan.seeds.includes(r.seed))) throw new Error('结果不匹配本次代码、清单、配置或seed，未导入');
    const sources = [file]; const resultsRoot = dirname(dirname(file));
    for (const r of data.runs) {
      const expectedLog = `results/seed-${r.seed}/train.log`;
      if (r.log !== expectedLog) throw new Error('日志路径与seed不一致');
      const log = safe(resultsRoot, r.log); if (statSync(log).size > 1_100_000 || sha(readFileSync(log)) !== r.logHash) throw new Error('日志校验失败');
      const copyLog = this.file(id, `receipts/seed-${r.seed}.log`); writeFileSync(copyLog, readFileSync(log)); sources.push(copyLog);
      if (r.metric !== undefined) {
        if (r.exitCode !== 0 || typeof r.metric !== 'number' || !Number.isFinite(r.metric) || (b.plan.metricUnit === 'percent' && (r.metric < 0 || r.metric > 100)) || (b.plan.metricUnit === 'fraction' && (r.metric < 0 || r.metric > 1)) || r.metrics !== `results/seed-${r.seed}/metrics.json`) throw new Error('指标与执行状态或指标单位不一致');
        const path = safe(resultsRoot, r.metrics); if (statSync(path).size > 1_100_000 || sha(readFileSync(path)) !== r.metricsHash || JSON.parse(readFileSync(path, 'utf8'))[b.plan.metricName] !== r.metric) throw new Error('指标文件校验失败');
        const target = this.file(id, `receipts/seed-${r.seed}-metrics.json`); writeFileSync(target, readFileSync(path)); sources.push(target);
      }
    }
    const values = data.runs.filter(r => r.metric !== undefined).map(r => r.metric!); const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const standardDeviation = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
    const complete = values.length === b.plan.seeds.length && data.status === 'completed';
    writeFileSync(this.file(id, 'receipts/bundle-results.json'), readFileSync(file)); b.receiptHash = digest(manifest(dirname(this.file(id, 'receipts/bundle-results.json'))));
    const existing = this.store.snapshot().proposals.find(p => p.id === b.proposalId)?.experiments.find(e => e.codeHash === b.codeHash && e.note.startsWith(`可复现实验包 ${id}；`));
    const result = b.proposalId.startsWith('baseline:') ? undefined : existing ?? this.store.recordExperiment(b.proposalId, { outcome: complete ? 'success' : 'failure', metricName: b.plan.metricName, metricValue: complete ? String(mean) : '', dataset: `${b.plan.dataset} / ${b.plan.split} / seeds=${b.plan.seeds.join(',')}`,
      command: `python3 run_experiment.py --manifest-sha256 ${b.manifestHash}`, note: `可复现实验包 ${id}；清单/日志/指标哈希已核对（非远程真实性证明）。${complete ? `多seed样本标准差=${standardDeviation}` : '部分seed失败或未完成，不能当作完整成功实验'}。镜像=${b.plan.image}。` }, sources);
    b.experimentId = result?.id; b.results = { seeds: data.runs.filter(r => r.metric !== undefined).map(r => r.seed), values, mean, standardDeviation, complete }; b.status = 'collected'; b.note = '结果已登记，仍需你人工确认后才能进入事实盒或发布。'; this.save(b); return b;
  }
  confirm(id: string, consent: boolean): ExperimentBundle {
    if (this.busy.has(id)) throw new Error('该实验操作正在进行，请等待当前操作完成');
    if (!consent) throw new Error('结果须由你人工核对并确认');
    const b = this.read(id); if (b.status !== 'collected' || !b.results) throw new Error('请先收回并核验结果');
    if (!b.receiptHash || b.receiptHash !== digest(manifest(dirname(this.file(id, 'receipts/bundle-results.json'))))) throw new Error('已回收凭据发生变化，不能确认');
    if (b.experimentId) this.store.confirmExperiment(b.proposalId, b.experimentId);
    b.confirmedAt = now(); this.save(b); return b;
  }
  compare(leftId: string, rightId: string): { comparable: boolean; reasons: string[]; delta?: number } {
    const a = this.read(leftId); const b = this.read(rightId); const reasons: string[] = [];
    if (leftId === rightId) reasons.push('不能与同一次实验比较');
    if (!a.results?.complete || !b.results?.complete) reasons.push('双方都需要完整的多seed结果');
    if (a.plan.seeds.length < 2 || b.plan.seeds.length < 2) reasons.push('多seed对照至少需要2个seed');
    if (!a.confirmedAt || !b.confirmedAt) reasons.push('双方结果均须由你确认');
    for (const item of [a, b]) {
      try { if (!item.receiptHash || item.receiptHash !== digest(manifest(dirname(this.file(item.id, 'receipts/bundle-results.json'))))) reasons.push('实验凭据已变化，不能继续使用旧确认'); }
      catch { reasons.push('实验凭据缺失，不能继续使用旧确认'); }
    }
    reasons.push(...configurationDifferences(a, b));
    return { comparable: reasons.length === 0, reasons, ...(reasons.length === 0 ? { delta: b.results!.mean - a.results!.mean } : {}) };
  }
  private claims(): ExperimentClaim[] {
    const file = safe(this.store.root, 'runs/innovation-claims.json');
    if (!existsSync(file)) return [];
    const claims: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(claims)) throw new Error('反例检验卡索引损坏');
    return claims as ExperimentClaim[];
  }
  lockClaim(input: ExperimentClaimInput): ExperimentClaim {
    const hypothesis = typeof input?.hypothesis === 'string' ? input.hypothesis.trim() : '';
    if (!hypothesis || hypothesis.length > 500) throw new Error('请填写要检验的主张（最多500字）');
    const readPair = (pair: ExperimentClaimPair, label: string) => {
      if (!pair || typeof pair.baselineId !== 'string' || typeof pair.candidateId !== 'string') throw new Error(`${label}：请选择对照包和候选包`);
      const a = this.read(pair.baselineId); const b = this.read(pair.candidateId);
      if (!a.proposalId.startsWith('baseline:') || b.proposalId.startsWith('baseline:') || a.codeHash === b.codeHash) throw new Error(`${label}：请选择公共对照和不同代码的候选包`);
      if (b.status !== 'prepared' || b.results || b.experimentId || this.busy.has(b.id)) throw new Error(`${label}：候选包须尚未提交或回收结果`);
      const reasons = configurationDifferences(a, b);
      if (a.plan.seeds.length < 2) reasons.push('至少需要2个相同seed');
      if (reasons.length) throw new Error(`${label}：${reasons.join('；')}`);
      const metricUnit = a.plan.metricUnit ?? 'percent';
      const limit = metricUnit === 'percent' ? 100 : metricUnit === 'fraction' ? 1 : Number.MAX_VALUE;
      if ((pair.direction !== 'higher' && pair.direction !== 'lower') || !Number.isFinite(pair.minimumGain) || pair.minimumGain <= 0 || pair.minimumGain > limit) throw new Error(`${label}：请选择改善方向并填写大于零且符合指标单位的阈值`);
      const record: LockedClaimPair = { baselineId: a.id, candidateId: b.id, direction: pair.direction, minimumGain: pair.minimumGain, baselineHash: claimBundleHash(a), candidateHash: claimBundleHash(b), dataset: a.plan.dataset, split: a.plan.split, metricName: a.plan.metricName, metricUnit };
      return { a, b, record };
    };
    const overall = readPair(input.overall, '总评'); const stress = readPair(input.stress, '反例');
    const p = this.store.snapshot().proposals.find(p => p.id === overall.b.proposalId);
    if (overall.a.proposalId !== stress.a.proposalId || overall.a.codeHash !== stress.a.codeHash || overall.b.proposalId !== stress.b.proposalId || overall.b.codeHash !== stress.b.codeHash || overall.a.proposalId !== `baseline:${p?.approval?.baselineVersionId}` || p?.implementationHash !== overall.b.codeHash) throw new Error('两组实验须对应同一公共版本与同一份已核查的候选代码');
    const review = p.reviews.at(-1);
    if (!review?.passed || review.codeHash !== overall.b.codeHash || p.publishedVersionId || this.store.codeHash(p.id) !== overall.b.codeHash) throw new Error('候选代码或核查已更新，请重新核查并生成新实验包');
    if (overall.a.splitHash === stress.a.splitHash) throw new Error('反例须使用不同的划分清单，不能拿同一组数据充当反例');
    const claims = this.claims();
    const candidates = new Set([overall.b.id, stress.b.id]);
    if (claims.some(c => candidates.has(c.overall.candidateId) || candidates.has(c.stress.candidateId))) throw new Error('候选包已被锁定，新的判据请使用新实验包');
    const claim: ExperimentClaim = { id: 'claim-' + randomUUID(), lockedAt: now(), hypothesis, overall: overall.record, stress: stress.record };
    atomic(safe(this.store.root, 'runs/innovation-claims.json', true), [...claims, claim]);
    return claim;
  }
  checkClaim(id: string): ExperimentClaimResult {
    const claim = this.claims().find(c => c.id === id);
    if (!claim) throw new Error('这个项目没有该反例检验卡');
    const check = (pair: LockedClaimPair): ClaimCheck => {
      try {
        const a = this.read(pair.baselineId); const b = this.read(pair.candidateId);
        if (claimBundleHash(a) !== pair.baselineHash || claimBundleHash(b) !== pair.candidateHash) return { status: 'insufficient', reason: '实验包信息已变化，不能用于原判据' };
        const comparison = this.compare(a.id, b.id);
        if (!comparison.comparable) return { status: 'insufficient', reason: [...new Set(comparison.reasons)].join('；') };
        const readMetrics = (bundle: ExperimentBundle): Map<number, number> => {
          const receipt = JSON.parse(readFileSync(this.file(bundle.id, 'receipts/bundle-results.json'), 'utf8')) as { bundleId: string; codeHash: string; manifestHash: string; plan: ExperimentPlan; status: string; runs: Array<{ seed: number; exitCode: number; metric: number }> };
          if (receipt.bundleId !== bundle.id || receipt.codeHash !== bundle.codeHash || receipt.manifestHash !== bundle.manifestHash || JSON.stringify(receipt.plan) !== JSON.stringify(bundle.plan) || receipt.status !== 'completed' || !Array.isArray(receipt.runs) || receipt.runs.length !== bundle.plan.seeds.length || receipt.runs.some(r => r.exitCode !== 0 || !bundle.plan.seeds.includes(r.seed) || !Number.isFinite(r.metric))) throw new Error('结果不匹配实验包');
          const values = new Map(receipt.runs.map(r => [r.seed, r.metric]));
          if (values.size !== bundle.plan.seeds.length) throw new Error('seed重复');
          return values;
        };
        const av = readMetrics(a); const bv = readMetrics(b);
        const pairs = a.plan.seeds.map(seed => ({ seed, baseline: av.get(seed)!, candidate: bv.get(seed)! }));
        const sign = pair.direction === 'higher' ? 1 : -1;
        const improvement = pairs.reduce((sum, p) => sum + sign * (p.candidate - p.baseline) / pairs.length, 0);
        if (!Number.isFinite(improvement)) return { status: 'insufficient', reason: '指标差超出可计算范围' };
        const tolerance = 8 * Number.EPSILON * Math.max(1, ...pairs.flatMap(p => [Math.abs(p.baseline), Math.abs(p.candidate)]));
        return { status: improvement > 0 && improvement + tolerance >= pair.minimumGain ? 'met' : 'not-met', improvement, pairs };
      } catch { return { status: 'insufficient', reason: '实验包或回收凭据缺失、损坏，不能核验' }; }
    };
    const overall = check(claim.overall); const stress = check(claim.stress);
    const status = overall.status === 'insufficient' || stress.status === 'insufficient' ? 'insufficient' : overall.status === 'met' && stress.status === 'met' ? 'met' : 'not-met';
    return { id, status, overall, stress };
  }
}
