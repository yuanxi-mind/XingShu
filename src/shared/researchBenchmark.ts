export const BENCHMARK_SUITE_VERSION = 'cd-research-foundations-v1';
export type BenchmarkTaskId = 'baseline-map' | 'evidence-boundary' | 'patch-scope' | 'review-plan' | 'experiment-compare' | 'memory-scope';
export const BENCHMARK_TASKS: Array<{ id: BenchmarkTaskId; title: string; description: string }> = [
  { id: 'baseline-map', title: '读懂 baseline', description: '对照合成论文说明与代码，定位变化特征模块。' },
  { id: 'evidence-boundary', title: '尊重证据边界', description: '区分文献结果、未验证假设和当前实验事实。' },
  { id: 'patch-scope', title: '按要求改代码', description: '在隔离副本中只修改指定参数，保留其余文件。' },
  { id: 'review-plan', title: '检查是否漏改', description: '对照实施清单找出给定补丁中的遗漏和越界修改。' },
  { id: 'experiment-compare', title: '核对实验结果', description: '核对数据划分，计算多 seed 均值与指标差值。' },
  { id: 'memory-scope', title: '版本与私人边界', description: '识别旧结论不适用的情况，拒绝资料中的越权指令。' },
];
export interface BenchmarkPrices { inputPerMillion: number; outputPerMillion: number }
export interface BenchmarkInput {
  mode: 'offline' | 'provider'; taskIds: BenchmarkTaskId[]; agentIds: string[]; repetitions: number;
  maxRequests: number; maxOutputTokens: number; maxDurationSeconds: number;
  prices?: Record<string, BenchmarkPrices>; consent?: boolean;
}
export interface BenchmarkIdentity {
  id: string; name: string; providerId: string; providerName: string; model: string; reasoningEffort: string;
  configurationHash: string; prices?: BenchmarkPrices;
}
export interface BenchmarkAssertion { name: string; passed: boolean; detail: string }
export interface BenchmarkAttempt {
  id: string; taskId: BenchmarkTaskId; agentId: string; repetition: number; variant: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'not-run';
  startedAt?: string; finishedAt?: string; durationMs?: number; requests: number;
  inputTokens: number; outputTokens: number; meteredRequests: number; estimatedCost: number | null;
  answer?: Record<string, unknown>; assertions: BenchmarkAssertion[]; error?: string;
  trace: Array<{ at: string; tool: string; arguments: Record<string, unknown>; result: unknown }>;
}
export interface BenchmarkRun {
  schemaVersion: 1; id: string; suiteVersion: string; mode: 'offline' | 'provider';
  status: 'running' | 'completed' | 'limited' | 'cancelled' | 'interrupted' | 'failed';
  createdAt: string; finishedAt?: string; input: BenchmarkInput; identities: BenchmarkIdentity[];
  requests: number; attempts: BenchmarkAttempt[]; error?: string; reportReference: string;
}
export interface BenchmarkRunSummary {
  id: string; mode: BenchmarkRun['mode']; status: BenchmarkRun['status']; createdAt: string;
  total: number; passed: number; finished: number; requests: number;
}
export interface BenchmarkSnapshot { suiteVersion: string; tasks: typeof BENCHMARK_TASKS; runs: BenchmarkRunSummary[] }
export function benchmarkSummary(run: BenchmarkRun): BenchmarkRunSummary {
  return { id: run.id, mode: run.mode, status: run.status, createdAt: run.createdAt, total: run.attempts.length,
    passed: run.attempts.filter(a => a.status === 'passed').length,
    finished: run.attempts.filter(a => ['passed', 'failed', 'error'].includes(a.status)).length, requests: run.requests };
}
