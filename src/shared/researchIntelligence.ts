export interface EvidenceNode {
  id: string; kind: 'source' | 'proposal' | 'code' | 'review' | 'experiment' | 'conclusion' | 'publication';
  title: string; detail: string; proposalId: string; reference?: string; hash?: string; quote?: string;
  assurance: 'hypothesis' | 'file-checked' | 'model-reviewed' | 'pending' | 'human-confirmed' | 'runner-verified';
  applicability: 'current' | 'historical' | 'unverified' | 'changed'; dataset?: string;
}
export interface EvidenceGraph { currentVersionId?: string; nodes: EvidenceNode[]; edges: Array<{ from: string; to: string; relation: string }> }
export interface ResearchMemoryHit {
  id: string; text: string; kind: 'hypothesis' | 'observation' | 'publication';
  scope: 'public' | 'private'; versionId?: string; codeHash?: string; dataset?: string;
  assurance: 'hypothesis' | 'human-confirmed'; applicability: 'current' | 'historical' | 'unverified';
  reference?: string; score: number;
}
export interface ExperimentPlan {
  entrypoint: string; args: string[]; seedFlag: string; seeds: number[]; dataset: string; split: string;
  dependencyFile: string; image: string; metricPath: string; metricName: string;
  timeoutSeconds: number; cpus: number; memoryGb: number; gpuDevices: string;
  splitManifest?: string;
  metricUnit?: 'percent' | 'fraction' | 'number';
}
export interface ExperimentBundle {
  id: string; proposalId: string; codeHash: string; createdAt: string; plan: ExperimentPlan;
  manifestHash: string; reference: string; archiveReference: string;
  status: 'prepared' | 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'collected';
  approvedAt?: string; remoteDirectory?: string; serverHash?: string; experimentId?: string; note?: string;
  dependencyHash?: string; splitHash?: string; confirmedAt?: string;
  archiveHash?: string; receiptHash?: string;
  results?: { seeds: number[]; values: number[]; mean: number; standardDeviation: number; complete: boolean };
}
export interface ResearchServer {
  host: string; port: number; username: string; identityFile: string; hostFingerprint: string;
  remoteRoot: string; datasetRoot: string;
}
export interface ExperimentClaimPair {
  baselineId: string; candidateId: string; direction: 'higher' | 'lower'; minimumGain: number;
}
export interface ExperimentClaimInput {
  hypothesis: string; overall: ExperimentClaimPair; stress: ExperimentClaimPair;
}
export interface LockedClaimPair extends ExperimentClaimPair {
  baselineHash: string; candidateHash: string; dataset: string; split: string; metricName: string; metricUnit: NonNullable<ExperimentPlan['metricUnit']>;
}
export interface ExperimentClaim {
  id: string; lockedAt: string; hypothesis: string; overall: LockedClaimPair; stress: LockedClaimPair;
}
export interface ClaimCheck {
  status: 'met' | 'not-met' | 'insufficient'; reason?: string;
  improvement?: number; pairs?: Array<{ seed: number; baseline: number; candidate: number }>;
}
export interface ExperimentClaimResult { id: string; status: ClaimCheck['status']; overall: ClaimCheck; stress: ClaimCheck }
export interface ExperimentSnapshot { server: ResearchServer | null; bundles: ExperimentBundle[]; claims: ExperimentClaim[] }
