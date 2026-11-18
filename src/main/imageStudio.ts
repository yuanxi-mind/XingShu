import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, statSync, copyFileSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, extname } from 'node:path';
import { MULTI_AGENT_ROOT } from './storagePaths';
import { agentApiMode, type ApiAgentConfig, type ProviderConfig, type CollabMessage, type ImageJob, type RequestImageJobInput, type AgentVisuals, type ImageStudioState } from '../shared/apiCollab';

const PROCESS_TOKEN = randomUUID();
const activeJobs = new Set<string>();
function read<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  if (lstatSync(file).isSymbolicLink()) throw new Error('生图配置文件不能是链接');
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
function directory(root: string, parts: string[]): string {
  let cursor = root;
  for (const part of parts) {
    if (!part || /[/\\]/u.test(part) || part === '.' || part === '..') throw new Error('生图文件路径无效');
    cursor = join(cursor, part);
    if (!existsSync(cursor)) mkdirSync(cursor);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('生图目录不能是链接');
  }
  return cursor;
}
function write(file: string, value: unknown): void {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('生图配置文件不能是链接');
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temp, file);
}

export const IMAGE_REQUEST_TOOL = {
  type: 'function', function: {
    name: 'request_image_generation',
    description: '向用户提交生图申请，不会立即生成或扣费。所有图片都使用默认生图助手，必须先由用户确认提示词和张数。仅在当前用户任务需要生成图片时调用。每个 prompts 元素生成一张。',
    parameters: { type: 'object', properties: { prompts: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 }, purpose: { type: 'string' } }, required: ['prompts'], additionalProperties: false }
  }
};

export const APPEARANCE_TOOL = {
  type: 'function', function: {
    name: 'set_chat_appearance',
    description: '用户明确要求时，使用当前项目内已有图片更换自己的头像或当前聊天背景。不生成图片，不调用付费接口。只接受共享资源或私聊时自己的 data 内的相对路径，不可更换他人头像。执行成功以程序返回为准。',
    parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['avatar', 'background'] }, source_path: { type: 'string', description: '例如 WorkGroup/data/avatar.png；PNG/JPEG/WebP，最多10MB' } }, required: ['kind', 'source_path'], additionalProperties: false }
  }
};

interface Dependencies {
  storageRoot?(): string;
  stateDirectory?(): string;
  agents(): ApiAgentConfig[];
  providers(): ProviderConfig[];
  saveAgent(agent: ApiAgentConfig): ApiAgentConfig[];
  root(projectId: string): string;
  publish(message: CollabMessage): void;
  generate(agent: ApiAgentConfig, provider: ProviderConfig, model: string, input: RequestImageJobInput, prompt: string): Promise<CollabMessage>;
}

export class ImageStudio {
  private listeners = new Set<(projectId?: string) => void>();
  constructor(private readonly dependencies: Dependencies) {}
  onUpdate(listener: (projectId?: string) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(projectId?: string): void { for (const listener of this.listeners) { try { listener(projectId); } catch { /* A view cannot cancel a committed job. */ } } }
  private assetRoot(): string { return this.dependencies.storageRoot?.() ?? MULTI_AGENT_ROOT; }
  private configRoot(): string { return this.dependencies.stateDirectory?.() ?? directory(MULTI_AGENT_ROOT, ['_runtime']); }
  private settingsFile(): string { return join(this.configRoot(), 'image-studio.json'); }
  private visualsFile(): string { return join(this.configRoot(), 'agent-visuals.json'); }
  private jobsFile(projectId: string): string { return join(directory(this.dependencies.root(projectId), ['runs']), 'image-jobs.json'); }
  private backgroundsFile(projectId: string): string { return join(directory(this.dependencies.root(projectId), ['runs']), 'chat-backgrounds.json'); }
  private projectImage(projectId: string, sourcePath: string, fromPicker = false): { bytes: Buffer; extension: string } {
    const root = realpathSync(this.dependencies.root(projectId));
    if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.includes('\0') || sourcePath.length > 4096 || (!fromPicker && isAbsolute(sourcePath))) throw new Error('请填写当前项目内的图片相对路径');
    const source = realpathSync(fromPicker ? sourcePath : join(root, sourcePath));
    const relativeSource = relative(root, source);
    if (!fromPicker && (!relativeSource || relativeSource === '..' || relativeSource.startsWith('../') || relativeSource.startsWith('..\\') || isAbsolute(relativeSource))) throw new Error('图片不在当前项目中');
    if (!statSync(source).isFile() || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(source).toLowerCase())) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
    const maxBytes = 10 * 1024 * 1024;
    if (statSync(source).size > maxBytes) throw new Error('图片不能超过 10 MB');
    const bytes = readFileSync(source);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('图片为空或超过 10 MB');
    const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? '.png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? '.jpg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? '.webp' : undefined;
    if (!extension) throw new Error('文件内容不是 PNG、JPEG 或 WebP 图片');
    return { bytes, extension };
  }
  setAvatar(projectId: string, agentId: string, sourcePath: string, fromPicker = false): void {
    if (!this.dependencies.agents().some((agent) => agent.id === agentId)) throw new Error('Agent 不存在');
    this.applyVisual(projectId, agentId, 'avatar', sourcePath, fromPicker);
  }
  setChatBackground(projectId: string, conversationId: string, sourcePath: string | null, fromPicker = false): void {
    const root = realpathSync(this.dependencies.root(projectId));
    let savedPath: string | null = null;
    if (sourcePath !== null) {
      const { bytes, extension } = this.projectImage(projectId, sourcePath, fromPicker);
      const destination = join(directory(root, ['runs', 'appearance', 'backgrounds']), `${randomUUID()}${extension}`);
      writeFileSync(destination, bytes, { flag: 'wx' });
      savedPath = relative(root, destination).replace(/\\/g, '/');
    }
    const backgrounds = read<Record<string, string | null>>(this.backgroundsFile(projectId), {});
    backgrounds[conversationId] = savedPath;
    write(this.backgroundsFile(projectId), backgrounds); this.notify(projectId);
  }
  defaultAgentId(): string | undefined { return read<{ defaultAgentId?: string }>(this.settingsFile(), {}).defaultAgentId; }
  clearDefault(agentId: string): void { if (this.defaultAgentId() === agentId) { write(this.settingsFile(), {}); this.notify(); } }
  setDefault(agentId: string): void { this.generator(agentId); write(this.settingsFile(), { defaultAgentId: agentId }); this.notify(); }
  private generator(agentId = this.defaultAgentId()): ImageJob['generator'] {
    const agent = this.dependencies.agents().find((item) => item.id === agentId && item.enabled);
    const provider = this.dependencies.providers().find((item) => item.id === agent?.providerId && item.enabled && item.baseUrl);
    if (!agent || !provider) throw new Error('请先配置默认生图助手的中转站、模型和密钥');
    const model = agent.model || provider.defaultModel;
    if (!model || agentApiMode(model, agent.apiMode) !== 'image') throw new Error('默认生图助手的请求类型需要设为“图片生成”');
    const configurationHash = createHash('sha256').update(JSON.stringify({ agentId: agent.id, providerId: provider.id, baseUrl: provider.baseUrl, model, headers: provider.headers ?? {} })).digest('hex');
    return { agentId: agent.id, providerId: provider.id, model, providerName: provider.name, baseUrl: provider.baseUrl, configurationHash };
  }
  setup(): string {
    if (this.defaultAgentId()) { this.generator(); return this.defaultAgentId()!; }
    const agents = this.dependencies.agents();
    let generator = agents.find((item) => item.id === 'image-generator');
    if (!generator) {
      const source = agents.find((agent) => {
        const provider = this.dependencies.providers().find((item) => item.id === agent.providerId);
        return agent.enabled && agentApiMode(agent.model || provider?.defaultModel || '', agent.apiMode) === 'image';
      });
      if (!source) throw new Error('请先给一个助手选好能用的生图模型，再创建独立生图助手');
      const provider = this.dependencies.providers().find((item) => item.id === source.providerId)!;
      generator = { id: 'image-generator', displayName: '生图助手', providerId: source.providerId, model: source.model || provider.defaultModel, apiMode: 'image', enabled: true };
      this.dependencies.saveAgent(generator);
      // Keep the original chat identity; the image model now has its own agent.
      if (source.id === 'gpt' && provider.defaultModel && agentApiMode(provider.defaultModel) === 'chat') this.dependencies.saveAgent({ ...source, model: provider.defaultModel, apiMode: 'chat' });
    }
    this.setDefault(generator.id);
    return generator.id;
  }
  state(projectId: string): ImageStudioState {
    const jobs = read<ImageJob[]>(this.jobsFile(projectId), []);
    let recovered = false;
    for (const job of jobs) if (job.status === 'running' && job.executionToken !== PROCESS_TOKEN) {
      job.status = 'interrupted'; job.error = '上次运行中断，已发出的请求可能已计费。请先查中转记录；不会自动继续或重试。';
      for (const item of job.items) if (item.status === 'running') { item.status = 'unknown'; item.error = job.error; }
      recovered = true;
    }
    if (recovered) write(this.jobsFile(projectId), jobs);
    return { assetRoot: this.assetRoot(), defaultAgentId: this.defaultAgentId(), jobs, visuals: read<AgentVisuals>(this.visualsFile(), { avatars: {}, backgrounds: {} }), conversationBackgrounds: read<Record<string, string | null>>(this.backgroundsFile(projectId), {}) };
  }
  private save(job: ImageJob): void {
    const jobs = read<ImageJob[]>(this.jobsFile(job.projectId), []);
    const index = jobs.findIndex((item) => item.id === job.id);
    if (index < 0) jobs.push(job); else jobs[index] = job;
    write(this.jobsFile(job.projectId), jobs); this.notify(job.projectId);
  }
  request(input: RequestImageJobInput): ImageJob {
    const agents = this.dependencies.agents();
    if (!agents.some((agent) => agent.id === input.requestedByAgentId)) throw new Error('申请生图的 Agent 不存在');
    if (!['private', 'workgroup', 'group'].includes(input.channel)) throw new Error('生图会话类型无效');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw new Error('每份申请需要明确列出 1 到 20 张图片');
    for (const item of input.items) {
      if (typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > 12000) throw new Error('每张图片的提示词需要是 1 到 12000 个字符');
      if (item.assetKind && !['avatar', 'background'].includes(item.assetKind)) throw new Error('图片用途无效');
      if (item.size && !['1024x1024', '1536x1024'].includes(item.size)) throw new Error('图片尺寸无效');
      if ((item.assetKind || item.targetAgentId) && !agents.some((agent) => agent.id === item.targetAgentId)) throw new Error('应用头像或背景的 Agent 不存在');
    }
    const job: ImageJob = { id: randomUUID(), projectId: input.projectId, requestedByAgentId: input.requestedByAgentId, conversationId: input.conversationId, channel: input.channel, purpose: input.purpose?.trim().slice(0, 200) || '生成图片',
      generator: this.generator(), items: input.items.map((item) => ({ id: randomUUID(), prompt: item.prompt.trim(), targetAgentId: item.targetAgentId, assetKind: item.assetKind, size: item.size, status: 'pending' })), status: 'pending', createdAt: new Date().toISOString() };
    this.save(job); return job;
  }
  portraitBatch(projectId: string): ImageJob {
    const defaultId = this.defaultAgentId();
    if (!defaultId) throw new Error('请先设置默认生图助手');
    const personas: Record<string, string> = {
      gpt: '深棕长发、琥珀色眼睛，祖母绿修身礼服，温柔自信的气质',
      claude: '红棕色波浪长发、棕色眼睛，香槟色修身礼服，成熟优雅的气质',
      deepseek: '黑色长发、深棕色眼睛，宝蓝色修身礼服，知性明朗的气质',
      gemini: '银棕色长发、灰绿色眼睛，淡紫色修身礼服，灵动浪漫的气质',
      grok: '黑色微卷长发、棕色眼睛，黑色修身晚礼服，明艳从容的气质'
    };
    const targets = this.dependencies.agents().filter((agent) => agent.id !== defaultId && agent.enabled);
    const explicitSize = /(?:^|[/:])gpt-image(?:-|$)/iu.test(this.generator().model);
    const items = targets.flatMap((agent) => {
      const subject = `一位明确年满25岁的虚构成年女性，漂亮精致，成熟性感，丰满有曲线的身材，${personas[agent.id] || '长发，合身时尚礼服，自信迷人的气质'}。穿着不透明的完整礼服。高质量写实商业时尚摄影，自然皮肤质感与真实解剖比例，柔和电影光线。不要文字、标志或水印。`;
      return [
        { targetAgentId: agent.id, assetKind: 'avatar' as const, size: explicitSize ? '1024x1024' as const : undefined, prompt: `为聊天软件的 ${agent.displayName} 设计一张女性角色头像。${subject}方形构图，头部与肩膀特写，脸部居中清晰，适合圆形头像裁切，背景简洁。` },
        { targetAgentId: agent.id, assetKind: 'background' as const, size: explicitSize ? '1536x1024' as const : undefined, prompt: `为与 ${agent.displayName} 的私聊设计一张美女背景照片。${subject}横向宽屏构图，优雅站姿的四分之三身时尚写真，展示身材曲线。人物位于画面右侧，中间与左侧保留简洁低对比空间以承载聊天文字，背景有柔焦灯光。` }
      ];
    });
    return this.request({ projectId, requestedByAgentId: defaultId, conversationId: `private:${defaultId}`, channel: 'private', purpose: `${targets.length} 位伙伴的头像与私聊背景（每位 2 张）`, items });
  }
  cancel(projectId: string, id: string): ImageJob {
    const job = this.state(projectId).jobs.find((item) => item.id === id);
    if (!job || !['pending', 'running'].includes(job.status)) throw new Error('该生图申请当前不能取消');
    job.status = 'cancelled'; job.error = '已取消。若有一张正在生成，该次请求仍可能计费并返回；不会继续生成下一张。'; this.save(job); return job;
  }
  async approve(projectId: string, id: string, count: number): Promise<ImageJob> {
    const job = this.state(projectId).jobs.find((item) => item.id === id);
    if (!job || job.status !== 'pending') throw new Error('这份申请已处理，不能重复批准或自动重试');
    if (count !== job.items.length) throw new Error('确认张数与申请不一致，请重新查看申请');
    if (this.generator().configurationHash !== job.generator.configurationHash) throw new Error('生图模型或中转配置已经变化，请重新提交申请再确认');
    if (activeJobs.size) throw new Error('已有生图任务进行中，请等待完成后再批准下一份');
    job.status = 'running'; job.approvedAt = new Date().toISOString(); job.approvedCount = count; job.executionToken = PROCESS_TOKEN;
    activeJobs.add(job.id);
    try {
      this.save(job);
      for (let index = 0; index < job.items.length; index++) {
        let latest = this.state(projectId).jobs.find((item) => item.id === id)!;
        if (latest.status !== 'running') break;
        if (this.generator().configurationHash !== job.generator.configurationHash) { latest.status = 'failed'; latest.error = '生成配置发生变化，剩余图片未提交。请重新申请并确认。'; this.save(latest); break; }
        latest.items[index].status = 'running'; this.save(latest);
        try {
          const item = latest.items[index];
          const owner = this.dependencies.agents().find((agent) => agent.id === (item.targetAgentId || job.requestedByAgentId));
          const provider = this.dependencies.providers().find((candidate) => candidate.id === job.generator.providerId);
          if (!owner || !provider) throw new Error('生图配置不存在，未提交请求');
          const result = await this.dependencies.generate(owner, provider, job.generator.model, { ...job, items: [item] }, item.prompt);
          latest = this.state(projectId).jobs.find((candidate) => candidate.id === id)!;
          latest.items[index].status = 'complete'; latest.items[index].resultPath = result.images?.[0]?.path;
          if (item.assetKind && item.targetAgentId && result.images?.[0]) this.applyVisual(projectId, item.targetAgentId, item.assetKind, result.images[0].path);
          this.dependencies.publish({ ...result, senderId: job.requestedByAgentId, recipientId: job.channel === 'private' ? 'human' : undefined, channel: job.channel, conversationId: job.conversationId, imageJobId: job.id, generatedByAgentId: job.generator.agentId });
          if (index === job.items.length - 1 && latest.status === 'running') latest.status = 'complete';
          this.save(latest);
        } catch (error) {
          latest = this.state(projectId).jobs.find((candidate) => candidate.id === id)!;
          latest.items[index].status = 'failed'; latest.items[index].error = String(error);
          if (latest.status === 'running') latest.status = 'failed';
          latest.error = `${String(error)}。已停止剩余请求，不会自动重试。`;
          this.save(latest); break;
        }
      }
      return this.state(projectId).jobs.find((item) => item.id === id)!;
    } finally { activeJobs.delete(job.id); }
  }
  private applyVisual(projectId: string, agentId: string, kind: 'avatar' | 'background', sourcePath: string, fromPicker = false): void {
    const { bytes, extension } = this.projectImage(projectId, sourcePath, fromPicker);
    const assets = directory(this.configRoot(), ['appearance', 'assets']);
    const destination = join(assets, `${agentId}-${kind}-${randomUUID()}${extension}`);
    writeFileSync(destination, bytes, { flag: 'wx' });
    const visuals = read<AgentVisuals>(this.visualsFile(), { avatars: {}, backgrounds: {} });
    visuals[kind === 'avatar' ? 'avatars' : 'backgrounds'][agentId] = relative(this.assetRoot(), destination).replace(/\\/g, '/');
    if (kind === 'avatar') this.dependencies.saveAgent({ ...this.dependencies.agents().find((agent) => agent.id === agentId)!, avatarPreset: 'custom' });
    write(this.visualsFile(), visuals); this.notify();
  }
}
