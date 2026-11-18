export interface ResearchEvidence { reference: string; reason: string; quote?: string; sourceHash?: string; offset?: number }
export interface ResearchProposalInput {
  title: string; summary: string; steps: string[]; evidence: ResearchEvidence[];
}
export interface ResearchVersion {
  id: string; name: string; kind: 'baseline' | 'release' | 'negative-result';
  createdAt: string; parentId?: string; proposalId?: string; publishedBy?: string;
  codeRef: string; documentsRef: string; evidenceRef?: string; digest: string;
  manifest: Record<string, string>; summary: string;
}
export interface ResearchApproval {
  revision: number; planHash: string; baselineVersionId: string;
  implementerId: string; reviewerId: string; approvedAt: string; workspaceRef: string;
}
export interface ResearchChange { path: string; type: 'added' | 'modified' | 'deleted'; before?: string; after?: string }
export interface ResearchReviewCheck { stepIndex: number; passed: boolean; evidence: string; files: string[] }
export interface ResearchReview {
  id: string; reviewerId: string; codeHash: string; planHash: string;
  passed: boolean; summary: string; checks: ResearchReviewCheck[]; createdAt: string;
}
export interface ResearchExperimentInput {
  outcome: 'success' | 'failure'; metricName: string; metricValue: string;
  dataset: string; command: string; note: string;
}
export interface ResearchExperiment extends ResearchExperimentInput {
  id: string; codeHash: string; evidenceRef: string; evidenceHash: string;
  createdAt: string; confirmedAt?: string;
}
export interface ResearchProposal extends ResearchProposalInput {
  sourceVersionId?: string;
  id: string; agentId: string; revision: number; createdAt: string; updatedAt: string;
  status: 'draft' | 'approved' | 'implemented' | 'review-failed' | 'review-passed' | 'pending-confirmation' | 'confirmed' | 'published';
  approval?: ResearchApproval; implementationHash?: string; implementationSummary?: string;
  reviews: ResearchReview[]; experiments: ResearchExperiment[]; publishedVersionId?: string;
}
export interface ResearchSharedProposal extends ResearchProposalInput {
  id: string; proposalId: string; agentId: string; revision: number; sharedAt: string;
}
export interface ResearchRun {
  id: string; action: 'propose' | 'implement' | 'review' | 'publish'; agentId: string;
  proposalId?: string; instruction: string; status: 'running' | 'complete' | 'failed' | 'interrupted';
  startedAt: string; finishedAt?: string; summary?: string; error?: string;
  receipts: Array<{ tool: string; ok: boolean; summary: string; at: string }>;
}
export interface ResearchState {
  schemaVersion: 1; currentVersionId?: string; versions: ResearchVersion[];
  proposals: ResearchProposal[]; sharedProposals: ResearchSharedProposal[]; runs: ResearchRun[];
}
export type ResearchRunInput =
  | { action: 'propose'; agentIds: string[]; instruction: string }
  | { action: 'implement' | 'review' | 'publish'; proposalId: string; agentId: string; instruction?: string };
export interface ResearchFile { path: string; size: number; hash: string }
export interface ResearchPreview { reference: string; text: string; nextOffset?: number; imageUrl?: string; hash?: string }
export interface ResearchTool {
  type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> };
}
