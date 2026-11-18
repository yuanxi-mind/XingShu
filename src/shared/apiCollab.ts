export type ApiRole = 'system' | 'user' | 'assistant';
export type CollabChannel = 'workgroup' | 'private' | 'group';
export type TaskStatus = 'pending' | 'running' | 'review' | 'done' | 'blocked' | 'failed' | 'rework';
export type ReasoningEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentApiMode = 'agent' | 'auto' | 'chat' | 'image';
export type PermissionProfile = 'assistant' | 'worker' | 'checker';
export const AVATAR_PRESETS = ['gpt', 'claude', 'deepseek', 'gemini', 'grok'] as const;
export type AvatarPreset = typeof AVATAR_PRESETS[number] | 'auto' | 'custom';

// `auto` remains the pure model-family detector for legacy callers. Agent
// configurations default to the explicit `agent` value, which intentionally
// means the local orchestrator over the provider's compatible chat endpoint.
export function agentApiMode(model: string, mode: AgentApiMode = 'auto'): 'chat' | 'image' {
  if (mode === 'agent') return 'chat';
  if (mode !== 'auto') return mode;
  return /(?:^|[/:])(?:gpt-image|dall-e)(?:[-._]|$)/iu.test(model) ? 'image' : 'chat';
}

export interface ProviderConfig {
  id: string;
  name: string;
  protocol: 'openai-compatible';
  baseUrl: string;
  apiKeyRef: string;
  defaultModel: string;
  models?: string[];
  timeoutMs: number;
  enabled: boolean;
  headers?: Record<string, string>;
  stream?: boolean;
  retryPolicy?: {
    maxRetries?: number;
    backoffMs?: number;
  };
  hasSecret?: boolean;
}

export interface ApiAgentConfig {
  id: string;
  displayName: string;
  providerId: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  apiMode?: AgentApiMode;
  systemPrompt?: string;
  enabled: boolean;
  permissionProfile?: PermissionProfile;
  avatarPreset?: AvatarPreset;
}

export interface CollabMessage {
  id: string;
  inReplyTo?: string;
  projectId: string;
  channel: CollabChannel;
  senderId: string;
  recipientId?: string;
  conversationId?: string;
  content: string;
  runtimeRole?: string;
  taskId?: string;
  speakerOrder?: string[];
  createdAt: string;
  status?: 'complete' | 'error';
  error?: string;
  images?: Array<{ path: string }>;
  imageJobId?: string;
  generatedByAgentId?: string;
}

export interface ImageJobItem {
  id: string;
  prompt: string;
  targetAgentId?: string;
  assetKind?: 'avatar' | 'background';
  size?: '1024x1024' | '1536x1024';
  status: 'pending' | 'running' | 'complete' | 'failed' | 'unknown';
  resultPath?: string;
  error?: string;
}

export interface ImageJob {
  id: string;
  projectId: string;
  requestedByAgentId: string;
  conversationId: string;
  channel: CollabChannel;
  purpose: string;
  items: ImageJobItem[];
  generator: { agentId: string; providerId: string; model: string; providerName: string; baseUrl: string; configurationHash: string };
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: string;
  approvedAt?: string;
  approvedCount?: number;
  executionToken?: string;
  error?: string;
}

export interface RequestImageJobInput {
  projectId: string;
  requestedByAgentId: string;
  conversationId: string;
  channel: CollabChannel;
  purpose?: string;
  items: Array<Pick<ImageJobItem, 'prompt' | 'targetAgentId' | 'assetKind' | 'size'>>;
}

export interface AgentVisuals {
  avatars: Record<string, string>;
  backgrounds: Record<string, string>;
}

export interface ImageStudioState {
  assetRoot?: string;
  defaultAgentId?: string;
  jobs: ImageJob[];
  visuals: AgentVisuals;
  conversationBackgrounds?: Record<string, string | null>;
}

export interface StreamUpdate {
  projectId: string;
  conversationId: string;
  agentId: string;
  inReplyTo: string;
  content: string;
  state: 'delta' | 'clear';
}

export interface CollabTask {
  id: string;
  projectId: string;
  assignedAgentId?: string;
  runtimeRole?: string;
  description: string;
  deadline?: string;
  status: TaskStatus;
  revisionCount: number;
  resultReference?: string;
  dependsOn?: string[];
  reviewerAgentId?: string;
  includeDependencyResults?: boolean;
  publishResult?: boolean;
  maxRevisions?: number;
  error?: string;
  reviewNote?: string;
  runningProcessId?: number;
  runningToken?: string;
  createdAt: string;
  updatedAt: string;
  proposalReference?: string;
  proposalHash?: string;
  baselineReference?: string;
  baselineHash?: string;
  workspaceReference?: string;
  changedFiles?: string[];
  checkerVerdict?: 'pass' | 'rework' | 'reject';
  checkerReportReference?: string;
  publishStatus?: 'private' | 'proposed' | 'accepted';
  resultHash?: string;
  workspaceHash?: string;
  proposalManifest?: string[];
  baselineManifest?: string[];
}

export interface ProjectSnapshot {
  projectId: string;
  projectRoot: string;
  providers: ProviderConfig[];
  agents: ApiAgentConfig[];
  workgroup: CollabMessage[];
  privateChats: Record<string, CollabMessage[]>;
  tasks: CollabTask[];
  groups: CollabGroup[];
  groupChats: Record<string, CollabMessage[]>;
  imageStudio?: ImageStudioState;
}

export interface CollabProject {
  id: string;
  name: string;
  root: string;
  createdAt: string;
}

export interface CollabGroup {
  id: string;
  projectId: string;
  name: string;
  memberAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageInput {
  messageId?: string;
  projectId: string;
  content: string;
  runtimeRole?: string;
  taskId?: string;
  conversationId?: string;
  speakerOrder?: string[];
}

export interface PrivateMessageInput extends SendMessageInput {
  agentId: string;
}

export interface CreateTaskInput {
  projectId: string;
  assignedAgentId?: string;
  runtimeRole?: string;
  description: string;
  deadline?: string;
  dependsOn?: string[];
  reviewerAgentId?: string;
  includeDependencyResults?: boolean;
  publishResult?: boolean;
  maxRevisions?: number;
  proposalReference?: string;
  baselineReference?: string;
  workspaceReference?: string;
}

export interface CreateGroupInput {
  projectId: string;
  name: string;
  memberAgentIds: string[];
}

export interface PaperWorkflowTaskInput {
  key: string;
  description: string;
  assignedAgentId: string;
  runtimeRole?: string;
  dependsOnKeys?: string[];
  reviewerAgentId?: string;
  includeDependencyResults?: boolean;
  publishResult?: boolean;
  maxRevisions?: number;
}

export interface PaperWorkflowInput {
  projectId: string;
  name?: string;
  tasks: PaperWorkflowTaskInput[];
  supervisorAgentId?: string;
}

export interface PaperWorkflowResult {
  workflowId: string;
  taskIds: string[];
  reportReference: string;
}

export type CreateWorkflowInput = PaperWorkflowInput;
export type CreateWorkflowResult = PaperWorkflowResult;
export type WorkflowTaskDefinition = PaperWorkflowTaskInput;

export interface RunCycleResult {
  ok: boolean;
  responses: CollabMessage[];
  error?: string;
}
