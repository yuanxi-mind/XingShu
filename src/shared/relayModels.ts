import { agentApiMode, type AgentApiMode, type ApiAgentConfig, type ProviderConfig } from './apiCollab';

export function relayModels(provider: ProviderConfig | undefined, agents: ApiAgentConfig[] = [], remote: string[] = []): string[] {
  if (!provider) return [];
  return [...new Set([provider.defaultModel, ...(provider.models ?? []), ...agents.filter((agent) => agent.providerId === provider.id).map((agent) => agent.model), ...remote].filter((model): model is string => typeof model === 'string' && Boolean(model.trim())).map((model) => model.trim()))].sort();
}

export function modeForModel(model: string, previous: AgentApiMode = 'agent'): AgentApiMode {
  return agentApiMode(model) === 'image' ? 'image' : previous === 'image' ? 'agent' : previous;
}
