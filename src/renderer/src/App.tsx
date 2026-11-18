import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { agentApiMode, type AgentApiMode, type ApiAgentConfig, type CollabMessage, type CollabProject, type ProjectSnapshot, type ProviderConfig, type ReasoningEffort, type StreamUpdate } from '@shared/apiCollab';
import { relayModels, modeForModel } from '@shared/relayModels';
import home from './vendor/nextchat/components/home.module.scss';
import chat from './vendor/nextchat/components/chat.module.scss';
import settings from './vendor/nextchat/components/settings.module.scss';
import { Icon, IconButton, List, ListItem, Modal, MessageBubble, ToolMenu } from './NextChat';
import { AgentAvatar, agentStyle, WorkspaceCompanion } from './AgentAvatar';
import { mergeMessage, mergeSnapshot } from './chatState';
import { AppearancePanel } from './AppearancePanel';
import { ModelPicker } from './ModelPicker';
import { AgentApiModePicker } from './AgentApiModePicker';
import { AgentManager } from './AgentManager';
import { TaskWorkspace } from './TaskWorkspace';
import { ResearchWorkspace } from './ResearchWorkspace';
import { AgentVisualProvider, useLocalImage } from './AgentVisuals';
import { ImageStudioPanel } from './ImageStudioPanel';
import { ChatBackgroundPanel } from './ChatBackgroundPanel';
import { MentionPicker } from './MentionPicker';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import brandMark from './assets/xingshu.svg';
import { CHAT_FONTS, UI_FONT, readAppearance, projectUiKey } from './uiPreferences';
import './vendor/nextchat/styles/globals.scss';
import './vendor/nextchat/styles/markdown.scss';
import './vendor/nextchat/styles/highlight.scss';
import './App.css';
import './Studio.css';

const PROJECTS_ROOT = 'D:\\Multi-Agent';

function parseOrder(value: string): string[] {
  return value.split(/[,，、>→\s]+/u).map((item) => item.trim()).filter(Boolean);
}

function dateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function conversationMeta(messages: CollabMessage[], fallback: string): { preview: string; time: string } {
  const latest = messages[messages.length - 1];
  if (!latest) return { preview: fallback, time: '' };
  const date = new Date(latest.createdAt);
  const today = new Date();
  const time = date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  return { preview: latest.content.replace(/\s+/g, ' ').trim(), time };
}

export function App() {
  const [projects, setProjects] = useState<CollabProject[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [conversationId, setConversationId] = useState('workgroup');
  const [message, setMessage] = useState('');
  const [runtimeRole, setRuntimeRole] = useState('');
  const [speakerOrder, setSpeakerOrder] = useState('');
  const [mentionAll, setMentionAll] = useState(false);
  const [mentionAgentIds, setMentionAgentIds] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelLoadError, setModelLoadError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [chatProviderDraft, setChatProviderDraft] = useState('');
  const [chatModelDraft, setChatModelDraft] = useState('');
  const [chatEffortDraft, setChatEffortDraft] = useState<ReasoningEffort>('default');
  const [chatApiModeDraft, setChatApiModeDraft] = useState<AgentApiMode>('agent');
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [showImageStudio, setShowImageStudio] = useState(false);
  const [showChatBackground, setShowChatBackground] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeRun, setActiveRun] = useState<{ projectId: string; conversationId: string; messageId: string; agentIds: string[]; sequential: boolean; phase: 'sending' | 'responding' } | null>(null);
  const [failedDelivery, setFailedDelivery] = useState<Record<string, string>>({});
  const [liveStreams, setLiveStreams] = useState<Record<string, StreamUpdate>>({});
  const [error, setError] = useState('');
  const [showProviders, setShowProviders] = useState(false);
  const [settingsProviderId, setSettingsProviderId] = useState('');
  const [messageView, setMessageView] = useState(() => localStorage.getItem('tongzhou-message-view') === 'document' ? 'document' : 'bubble');
  const [pixelMotion, setPixelMotion] = useState(() => localStorage.getItem('tongzhou-pixel-motion') !== 'off');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [sidebarPage, setSidebarPage] = useState<'chats' | 'tasks' | 'research'>('chats');
  const [conversationSearch, setConversationSearch] = useState('');
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentProviderId, setNewAgentProviderId] = useState('');
  const [newAgentModel, setNewAgentModel] = useState('');
  const [editingWorkgroup, setEditingWorkgroup] = useState(false);
  const [workgroupNameDraft, setWorkgroupNameDraft] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(230, Math.min(520, Number(localStorage.getItem('nextchat-sidebar-width')) || 256)));
  const [composerHeight, setComposerHeight] = useState(() => Math.max(48, Math.min(280, Number(localStorage.getItem('nextchat-input-height')) || 56)));
  const [appearance, setAppearance] = useState(() => readAppearance());
  const [showAppearance, setShowAppearance] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('tongzhou-sidebar-collapsed') === 'true');
  const [membersCollapsed, setMembersCollapsed] = useState(() => localStorage.getItem('tongzhou-members-collapsed') !== 'false');
  const [composerCollapsed, setComposerCollapsed] = useState(() => localStorage.getItem('tongzhou-composer-collapsed') === 'true');
  const [expandedEditor, setExpandedEditor] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const modelRequestRef = useRef(0);
  const modelCacheRef = useRef(new Map<string, string[]>());
  const resizeRef = useRef<{ axis: 'x' | 'y'; origin: number; size: number } | null>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const projectRef = useRef(projectId);
  const conversationRef = useRef(conversationId);
  const inFlightRef = useRef<{ messageId: string; accepted: boolean } | null>(null);
  projectRef.current = projectId;
  conversationRef.current = conversationId;

  const refresh = async (): Promise<void> => {
    if (!projectId) return;
    const latest = await window.cth.apiCollabSnapshot(projectId);
    if (projectRef.current === projectId) setSnapshot((previous) => mergeSnapshot(latest, previous));
    if (projectRef.current === projectId) {
      const ids = new Set(latest.agents.map((agent) => agent.id));
      setMentionAgentIds((current) => current.filter((id) => ids.has(id)));
      setSelectedAgent((current) => ids.has(current) ? current : '');
      if (conversationRef.current.startsWith('private:') && !ids.has(conversationRef.current.slice(8))) setConversationId('workgroup');
    }
  };
  useEffect(() => window.cth.onApiCollabMessage((incoming) => {
    setSnapshot((previous) => mergeMessage(previous, incoming));
    if (incoming.imageJobId && !incoming.images?.length && incoming.projectId === projectRef.current) setShowImageStudio(true);
    if (incoming.senderId !== 'human') setLiveStreams((previous) => {
      if (previous[incoming.senderId]?.inReplyTo !== incoming.inReplyTo) return previous;
      const next = { ...previous }; delete next[incoming.senderId]; return next;
    });
    if (incoming.senderId === 'human' && incoming.id === inFlightRef.current?.messageId) {
      inFlightRef.current.accepted = true;
      setActiveRun((previous) => previous?.messageId === incoming.id ? { ...previous, phase: 'responding' } : previous);
    }
  }), []);
  useEffect(() => window.cth.onApiCollabImageUpdate?.((id) => {
    const current = projectRef.current;
    if (current && (!id || id === current)) void window.cth.apiCollabSnapshot(current).then((latest) => {
      if (projectRef.current === current) setSnapshot((previous) => mergeSnapshot(latest, previous));
    }).catch((cause) => setError(String(cause)));
  }), []);
  useEffect(() => window.cth.onApiCollabStream((update) => {
    if (update.inReplyTo !== inFlightRef.current?.messageId) return;
    setLiveStreams((previous) => {
      const next = { ...previous };
      if (update.state === 'clear') delete next[update.agentId]; else next[update.agentId] = update;
      return next;
    });
  }), []);
  useEffect(() => {
    void window.cth.apiCollabListProjects().then((list) => {
      if (!localStorage.getItem('xingshu-project-ui-v1')) {
        for (const project of list) for (const name of ['tongzhou-appearance', 'tongzhou-message-view', 'tongzhou-pixel-motion', 'nextchat-sidebar-width', 'nextchat-input-height', 'tongzhou-sidebar-collapsed', 'tongzhou-members-collapsed', 'tongzhou-composer-collapsed']) {
          const value = localStorage.getItem(name);
          if (value !== null && localStorage.getItem(projectUiKey(name, project.id)) === null) localStorage.setItem(projectUiKey(name, project.id), value);
        }
        localStorage.setItem('xingshu-project-ui-v1', '1');
      }
      setProjects(list);
    }).catch((e) => setError(String(e))).finally(() => setProjectsLoaded(true));
  }, []);
  useEffect(() => { localStorage.setItem(projectUiKey('nextchat-sidebar-width', projectId), String(sidebarWidth)); }, [sidebarWidth, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('nextchat-input-height', projectId), String(composerHeight)); }, [composerHeight, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-message-view', projectId), messageView); }, [messageView, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-pixel-motion', projectId), pixelMotion ? 'on' : 'off'); }, [pixelMotion, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-appearance', projectId), JSON.stringify(appearance)); document.body.className = appearance.theme; }, [appearance, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-sidebar-collapsed', projectId), String(sidebarCollapsed)); }, [sidebarCollapsed, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-members-collapsed', projectId), String(membersCollapsed)); }, [membersCollapsed, projectId]);
  useEffect(() => { localStorage.setItem(projectUiKey('tongzhou-composer-collapsed', projectId), String(composerCollapsed)); }, [composerCollapsed, projectId]);
  useEffect(() => { setMentionAll(false); setMentionAgentIds([]); setSpeakerOrder(''); setRuntimeRole(''); setShowMentions(false); }, [projectId, conversationId]);
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = resizeRef.current;
      if (!drag) return;
      if (drag.axis === 'x') setSidebarWidth(Math.max(230, Math.min(520, drag.size + event.clientX - drag.origin)));
      else setComposerHeight(Math.max(48, Math.min(Math.round(window.innerHeight * 0.45), drag.size + drag.origin - event.clientY)));
    };
    const end = (): void => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, []);

  const beginResize = (axis: 'x' | 'y', size: number, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    resizeRef.current = { axis, origin: axis === 'x' ? event.clientX : event.clientY, size };
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const loadProjectUi = (id: string): void => {
    const get = (name: string) => localStorage.getItem(projectUiKey(name, id));
    setAppearance(readAppearance(projectUiKey('tongzhou-appearance', id)));
    setMessageView(get('tongzhou-message-view') === 'document' ? 'document' : 'bubble'); setPixelMotion(get('tongzhou-pixel-motion') !== 'off');
    setSidebarWidth(Math.max(230, Math.min(520, Number(get('nextchat-sidebar-width')) || 256)));
    setComposerHeight(Math.max(48, Math.min(280, Number(get('nextchat-input-height')) || 56)));
    setSidebarCollapsed(get('tongzhou-sidebar-collapsed') === 'true'); setMembersCollapsed(get('tongzhou-members-collapsed') !== 'false'); setComposerCollapsed(get('tongzhou-composer-collapsed') === 'true');
  };
  const openProject = async (id: string): Promise<void> => {
    projectRef.current = id;
    stickToBottomRef.current = true;
    setProjectId(id); setShowProviders(false); setShowNewChat(false); setSidebarPage('chats');
    setSnapshot(null);
    setConversationId('workgroup');
    conversationRef.current = 'workgroup'; loadProjectUi(id);
    setMessage(''); setSelectedAgent(''); setSelectedDate(dateKey(new Date().toISOString())); setConversationSearch(''); setRuntimeRole('');
    setShowChatSettings(false); setShowImageStudio(false); setShowChatBackground(false); setShowCreateGroup(false); setShowCreateAgent(false); setShowAppearance(false); setShowHistory(false); setShowCapabilities(false); setShowExport(false); setShowSearch(false); setShowMentions(false);
    setGroupName(''); setGroupMembers([]); setNewAgentName(''); setNewAgentProviderId(''); setNewAgentModel(''); setSettingsProviderId('');
    setExpandedEditor(false); setFocusMode(false); setEditingWorkgroup(false); setWorkgroupNameDraft(''); setFailedDelivery({});
    modelRequestRef.current++; modelCacheRef.current.clear(); setAvailableModels([]); setModelLoadError(''); setChatProviderDraft(''); setChatModelDraft(''); setLiveStreams({});
    setError('');
    try { await window.cth.apiCollabRecoverInterruptedTasks(id); const loaded = await window.cth.apiCollabSnapshot(id); if (projectRef.current === id) setSnapshot((previous) => mergeSnapshot(loaded, previous)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const createProject = async (): Promise<void> => {
    if (!newProjectName.trim()) return;
    setBusy(true); setError('');
    try {
      const project = await window.cth.apiCollabCreateProject(newProjectName);
      setProjects((all) => [...all, project].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
      setNewProjectName('');
      await openProject(project.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const currentGroup = snapshot?.groups.find((group) => group.id === conversationId);
  const workgroup = snapshot?.groups.find((group) => group.id === 'workgroup');
  const privateAgentId = conversationId.startsWith('private:') ? conversationId.slice('private:'.length) : '';
  const privateAgent = snapshot?.agents.find((agent) => agent.id === privateAgentId);
  const imageAssetRoot = snapshot?.imageStudio?.assetRoot || PROJECTS_ROOT;
  const conversationBackground = snapshot?.imageStudio?.conversationBackgrounds?.[conversationId];
  const chatBackground = useLocalImage(conversationBackground === undefined ? imageAssetRoot : snapshot?.projectRoot || '', conversationBackground === undefined ? snapshot?.imageStudio?.visuals.backgrounds[privateAgentId] : conversationBackground || undefined);
  const setChatBackground = async (path: string): Promise<void> => { await window.cth.apiCollabSetChatBackground(projectId, conversationId, path); await refresh(); };
  const currentTitle = conversationId === 'workgroup' ? workgroup?.name ?? '总工作群' : currentGroup?.name ?? `与 ${privateAgent?.displayName ?? '智能体'} 私聊`;
  const isGroupConversation = conversationId === 'workgroup' || Boolean(currentGroup);
  const groupAgents = snapshot?.agents.filter((agent) => !currentGroup || currentGroup.memberAgentIds.includes(agent.id)) ?? [];

  const messages = useMemo<CollabMessage[]>(() => {
    if (!snapshot) return [];
    if (conversationId === 'workgroup') return snapshot.workgroup;
    if (currentGroup) return snapshot.groupChats[currentGroup.id] ?? [];
    return snapshot.privateChats[privateAgentId] ?? [];
  }, [conversationId, currentGroup, privateAgentId, snapshot]);

  useEffect(() => {
    const latestDate = messages.at(-1)?.createdAt ? dateKey(messages.at(-1)!.createdAt) : dateKey(new Date().toISOString());
    setSelectedDate(latestDate);
    setMentionAll(false);
    setMentionAgentIds([]);
    setSpeakerOrder('');
    setAvailableModels([]);
    setModelLoadError('');
    stickToBottomRef.current = true;
  }, [projectId, conversationId, Boolean(snapshot)]);

  useEffect(() => {
    if (!privateAgent || showChatSettings) return;
    setChatProviderDraft(privateAgent.providerId);
    setChatModelDraft(privateAgent.model ?? '');
    setChatEffortDraft(privateAgent.reasoningEffort ?? 'default');
    setChatApiModeDraft(privateAgent.apiMode ?? 'auto');
  }, [privateAgent?.id, privateAgent?.providerId, privateAgent?.model, privateAgent?.reasoningEffort, privateAgent?.apiMode, showChatSettings]);

  const visibleMessages = useMemo(() => messages.filter((item) => dateKey(item.createdAt) === selectedDate), [messages, selectedDate]);
  const currentRun = activeRun?.projectId === projectId && activeRun.conversationId === conversationId ? activeRun : null;
  const runReplies = currentRun ? messages.filter((item) => item.inReplyTo === currentRun.messageId && item.senderId !== 'human') : [];
  const waitingAgentIds = currentRun?.agentIds.filter((id) => !runReplies.some((item) => item.senderId === id)) ?? [];
  const waitingAgentId = waitingAgentIds[0];
  const waitingAgent = snapshot?.agents.find((agent) => agent.id === waitingAgentId);
  const pendingAgents = (currentRun?.sequential ? waitingAgentIds.slice(0, 1) : waitingAgentIds).map((id) => snapshot?.agents.find((agent) => agent.id === id)).filter((agent): agent is ApiAgentConfig => Boolean(agent));
  const currentStreams = Object.values(liveStreams).filter((stream) => stream.projectId === projectId && stream.conversationId === conversationId && stream.inReplyTo === currentRun?.messageId);
  useLayoutEffect(() => {
    const body = chatBodyRef.current;
    if (body && stickToBottomRef.current) body.scrollTop = body.scrollHeight;
  }, [messages.length, selectedDate, conversationId, currentRun?.phase, showProviders, liveStreams]);

  const selectPrivate = (agent: ApiAgentConfig): void => {
    conversationRef.current = `private:${agent.id}`;
    stickToBottomRef.current = true;
    setSelectedAgent(agent.id);
    setConversationId(`private:${agent.id}`);
    setError('');
  };

  const send = async (): Promise<void> => {
    const text = message.trim();
    if (!text || busy || inFlightRef.current || !snapshot) return;
    const pickedIds = groupAgents.filter((agent) => agent.enabled && (mentionAll || mentionAgentIds.includes(agent.id))).map((agent) => agent.id);
    if (isGroupConversation && pickedIds.length === 0) { setError('先选择 @全体或至少一位智能体'); return; }
    const mentionText = isGroupConversation
      ? `${mentionAll ? '@全体' : pickedIds.map((id) => `@${groupAgents.find((agent) => agent.id === id)?.displayName ?? id}`).join(' ')} `
      : '';
    const content = `${mentionText}${text}`.trim();
    const messageId = crypto.randomUUID();
    const outgoing: CollabMessage = { id: messageId, projectId, conversationId, channel: isGroupConversation ? (conversationId === 'workgroup' ? 'workgroup' : 'group') : 'private', senderId: 'human', recipientId: privateAgentId || undefined, content, createdAt: new Date().toISOString(), status: 'complete' };
    const order = parseOrder(speakerOrder || text.match(/顺序\s*[:：]\s*([^\n]+)/u)?.[1] || '');
    const ordered = order.map((name) => groupAgents.find((agent) => agent.id.toLowerCase() === name.toLowerCase() || agent.displayName.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => Boolean(id) && pickedIds.includes(id!));
    inFlightRef.current = { messageId, accepted: false };
    setActiveRun({ projectId, conversationId, messageId, agentIds: isGroupConversation ? (ordered.length === pickedIds.length ? ordered : pickedIds) : [privateAgentId], sequential: !isGroupConversation || order.length > 0, phase: 'sending' });
    stickToBottomRef.current = true;
    setSelectedDate(dateKey(outgoing.createdAt));
    setSnapshot((previous) => mergeMessage(previous, outgoing));
    setMessage('');
    setBusy(true); setError('');
    try {
      const input = { messageId, projectId, content, runtimeRole: runtimeRole || undefined, speakerOrder: order };
      const response = conversationId === 'workgroup' ? await window.cth.apiCollabSendWorkgroup(input)
        : currentGroup ? await window.cth.apiCollabSendGroup({ ...input, conversationId: currentGroup.id })
        : await window.cth.apiCollabSendPrivate({ ...input, agentId: privateAgentId });
      inFlightRef.current.accepted = true;
      setSnapshot((previous) => mergeMessage(previous, response));
      setActiveRun((previous) => previous?.messageId === messageId ? { ...previous, phase: 'responding' } : previous);
      if (isGroupConversation) {
        const result = await window.cth.apiCollabRunCycle(projectId, conversationId);
        for (const reply of result.responses) setSnapshot((previous) => mergeMessage(previous, reply));
        if (!result.ok && result.error && projectRef.current === projectId && conversationRef.current === conversationId) setError(result.error);
      }
      await refresh();
    } catch (e) {
      const detail = e instanceof Error ? e.message.replace(/^Error:\s*/u, '') : String(e);
      if (projectRef.current === projectId && conversationRef.current === conversationId) setError(detail);
      try {
        const latest = await window.cth.apiCollabSnapshot(projectId);
        const persisted = [...latest.workgroup, ...Object.values(latest.privateChats).flat(), ...Object.values(latest.groupChats).flat()].some((item) => item.id === messageId);
        if (persisted && inFlightRef.current) inFlightRef.current.accepted = true;
        if (projectRef.current === projectId) setSnapshot((previous) => mergeSnapshot(latest, previous));
      } catch { /* Keep the local message if the host cannot confirm delivery. */ }
      if (!inFlightRef.current?.accepted) {
        setFailedDelivery((previous) => ({ ...previous, [messageId]: '未发送，草稿已保留' }));
        if (projectRef.current === projectId && conversationRef.current === conversationId) setMessage((draft) => draft || text);
      }
    } finally { inFlightRef.current = null; setActiveRun(null); setLiveStreams({}); setBusy(false); }
  };

  const runCycle = async (): Promise<void> => {
    if (!isGroupConversation) { setError('私聊消息会自动回复'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.cth.apiCollabRunCycle(projectId, conversationId);
      if (!result.ok && result.error) setError(result.error);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error:\s*/u, '') : String(e)); }
    finally { setBusy(false); }
  };

  const createGroup = async (): Promise<void> => {
    if (!groupName.trim() || groupMembers.length === 0) { setError('请输入群聊名称并至少选择一个 Agent'); return; }
    setBusy(true); setError('');
    try {
      const group = await window.cth.apiCollabCreateGroup({ projectId, name: groupName.trim(), memberAgentIds: groupMembers });
      setConversationId(group.id); setGroupName(''); setGroupMembers([]); setShowCreateGroup(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const createAgent = async (): Promise<void> => {
    const displayName = newAgentName.trim();
    const providerId = newAgentProviderId;
    if (!displayName || !providerId) { setError('请输入智能体名称并选择中转站'); return; }
    if (!newAgentModel.trim()) { setError('请选择该智能体的模型'); return; }
    setBusy(true); setError('');
    try {
      await window.cth.apiCollabSaveAgent({ id: `agent-${crypto.randomUUID()}`, displayName, providerId, model: newAgentModel.trim() || undefined, apiMode: modeForModel(newAgentModel), reasoningEffort: 'default', permissionProfile: 'assistant', enabled: true }, projectId);
      setNewAgentName(''); setNewAgentModel(''); setShowCreateAgent(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const renameWorkgroup = async (): Promise<void> => {
    const name = workgroupNameDraft.trim();
    if (!name) { setError('总工作群名称不能为空'); return; }
    setBusy(true); setError('');
    try {
      await window.cth.apiCollabRenameGroup(projectId, 'workgroup', name);
      setEditingWorkgroup(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const saveChatAgent = async (): Promise<void> => {
    if (!privateAgent || busy) return;
    setBusy(true); setError('');
    try { await window.cth.apiCollabSaveAgent({ ...privateAgent, providerId: chatProviderDraft, model: chatModelDraft.trim() || undefined, reasoningEffort: chatEffortDraft, apiMode: chatApiModeDraft }, projectId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const loadModels = async (force = false): Promise<void> => {
    if (!privateAgent) return;
    const providerId = chatProviderDraft || privateAgent.providerId;
    const request = ++modelRequestRef.current;
    setModelLoadError('');
    const cached = modelCacheRef.current.get(providerId);
    if (!force && cached) { setAvailableModels(cached); setModelsLoading(false); return; }
    setModelsLoading(true); setAvailableModels([]);
    try {
      const models = await window.cth.apiCollabListModels(providerId);
      if (request !== modelRequestRef.current) return;
      modelCacheRef.current.set(providerId, models);
      setAvailableModels(models);
      if (!models.length) setModelLoadError('中转站没有返回模型列表，可直接填写模型 ID');
    } catch (e) { if (request === modelRequestRef.current) setModelLoadError(e instanceof Error ? e.message : String(e)); }
    finally { if (request === modelRequestRef.current) setModelsLoading(false); }
  };
  useEffect(() => { if (showChatSettings && privateAgent && chatProviderDraft) void loadModels(); else { modelRequestRef.current++; setModelsLoading(false); } }, [showChatSettings, privateAgent?.id, chatProviderDraft]);

  const goHome = (): void => { projectRef.current = ''; setProjectId(''); setSnapshot(null); setShowProviders(false); loadProjectUi(''); setError(''); };
  const selectConversation = (id: string): void => { conversationRef.current = id; stickToBottomRef.current = true; setConversationId(id); setShowProviders(false); setShowNewChat(false); setError(''); };
  const chatItem = (id: string, title: string, items: CollabMessage[]) => {
    const meta = conversationMeta(items, '');
    return <div key={id} role="button" tabIndex={0} aria-label={title} aria-current={conversationId === id && !showProviders ? 'page' : undefined}
      className={['tz-chat-row', home['chat-item'], conversationId === id && !showProviders && home['chat-item-selected']].filter(Boolean).join(' ')}
      onClick={() => selectConversation(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectConversation(id); } }}>
      <AgentAvatar id={id.startsWith('private:') ? id.slice(8) : 'workgroup'} animated={pixelMotion && conversationId === id} />
      <div className="tz-conversation-copy"><div className="tz-conversation-name">{title}</div><div className="tz-conversation-preview">{meta.preview || '还没有消息，开始一段对话'}</div></div>
      <span className="tz-conversation-time">{meta.time}</span>
    </div>;
  };

  const interfaceStyle = { '--sidebar-width': sidebarWidth + 'px', '--chat-font-size': appearance.fontSize + 'px', '--base-background': appearance.backgroundColor, '--ui-font': UI_FONT, '--chat-font': CHAT_FONTS[appearance.font] } as CSSProperties;
  return <AgentVisualProvider key={projectId || 'home'} root={imageAssetRoot} visuals={snapshot?.imageStudio?.visuals} agents={snapshot?.agents}><div className="tz-app" data-theme={appearance.theme} data-background={appearance.background} data-focus={focusMode} style={interfaceStyle}>
    <div className="tz-titlebar"><button aria-label={sidebarCollapsed || focusMode ? '展开侧栏' : '收起侧栏'} title={sidebarCollapsed || focusMode ? '展开侧栏' : '收起侧栏'} onClick={() => { if (focusMode) { setFocusMode(false); setSidebarCollapsed(false); } else setSidebarCollapsed((value) => !value); }}><svg viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.3" /><path d="M8 4v12" stroke="currentColor" strokeWidth="1.3" /></svg></button><strong>星枢<span> / </span><small>{projectId || '工作空间'}</small></strong><span className="tz-titlebar-local"><i />本地协作</span><button className="tz-titlebar-appearance" aria-label="外观设置" onClick={() => setShowAppearance(true)}><Icon name="light" /></button></div>
    <div className={'tz-studio ' + home['tight-container']} data-message-view={messageView} data-motion={pixelMotion ? 'on' : 'off'} data-sidebar={sidebarCollapsed ? 'collapsed' : 'open'}>
    <aside className={home.sidebar + ' tz-sidebar'} aria-label="会话列表">
      <div className="tz-brand">
        <img className="tz-brand-symbol" src={brandMark} alt="" />
        <div><div className="tz-brand-name">星枢</div><div className="tz-brand-tagline">本地智能体工作台</div></div>
      </div>
      <button className="tz-workspace" onClick={goHome} title="切换项目"><Icon name="folder" /><span>{projectId || '所有项目'}</span><Icon name="down" /></button>
      <div className="tz-sidebar-nav">
        <IconButton icon="add" text="新建会话" className={home['sidebar-bar-button']} onClick={() => { if (snapshot) setShowNewChat(true); else document.getElementById('nc-project-name')?.focus(); }} />
        <IconButton icon="search" title="搜索会话" className={home['sidebar-bar-button']} onClick={() => setShowSearch((value) => !value)} />
      </div>
      {showSearch && <input className="nc-search" autoFocus value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />}
      <div className={home['sidebar-body']}>
        {!projectsLoaded ? <div className="nc-hint">正在加载项目…</div> : !projectId ? <><div className="tz-section-label">我的项目<span>{projects.length}</span></div>{projects.map((project) => <div key={project.id} role="button" tabIndex={0} aria-label={project.name} className={home['chat-item'] + ' tz-chat-row'} onClick={() => void openProject(project.id)} onKeyDown={(event) => { if (event.key === 'Enter') void openProject(project.id); }}>
          <AgentAvatar id="workgroup" />
          <div className="tz-conversation-copy">
          <div className={home['chat-item-title']}>{project.name}</div><div className={home['chat-item-info']}><span>项目</span><span>{new Date(project.createdAt).toLocaleDateString('zh-CN')}</span></div>
          </div>
        </div>)}</> : snapshot ? <>
          <div className="tz-section-label"><span>群聊</span><span className="tz-section-actions"><small>{snapshot.groups.length}</small><button type="button" aria-label="创建群聊" title="创建群聊" onClick={() => setShowCreateGroup(true)}>＋</button></span></div>
          {(workgroup?.name ?? '总工作群').toLocaleLowerCase().includes(conversationSearch.toLocaleLowerCase()) && chatItem('workgroup', workgroup?.name ?? '总工作群', snapshot.workgroup)}
          {snapshot.groups.filter((group) => group.id !== 'workgroup' && group.name.toLocaleLowerCase().includes(conversationSearch.toLocaleLowerCase())).map((group) => chatItem(group.id, group.name, snapshot.groupChats[group.id] ?? []))}
          <div className="tz-section-label"><span>智能体</span><span className="tz-section-actions"><small>{snapshot.agents.length}</small><button type="button" aria-label="新建智能体" title="新建智能体" onClick={() => setShowCreateAgent(true)}>＋</button></span></div>
          {snapshot.agents.filter((agent) => agent.displayName.toLocaleLowerCase().includes(conversationSearch.toLocaleLowerCase())).map((agent) => chatItem('private:' + agent.id, agent.displayName, snapshot.privateChats[agent.id] ?? []))}
        </> : <div className="nc-hint">正在打开项目…</div>}
      </div>
      <div className={home['sidebar-tail'] + ' tz-sidebar-footer'}>
        <WorkspaceCompanion key={projectId || 'home'} projectId={projectId} />
        <div className={home['sidebar-actions']}>
          <div className={home['sidebar-action']}><IconButton icon="settings" text="设置" title="设置" shadow onClick={() => { if (snapshot) { setSettingsProviderId(''); setShowProviders((value) => !value); } else setError('请先创建或打开一个项目'); }} /></div>
          <div className={home['sidebar-action']}><IconButton icon="robot" text="能力与权限" title="能力与权限" shadow disabled={!snapshot} onClick={() => setShowCapabilities(true)} /></div><div className={home['sidebar-action']}><IconButton icon="github" title="关于星枢与开源来源" shadow onClick={() => setShowAbout(true)} /></div>
        </div>
      </div>
      <div role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" className={home['sidebar-drag']} onPointerDown={(event) => beginResize('x', sidebarWidth, event)}><Icon name="drag" /></div>
    </aside>

    <main className={home['window-content'] + ' tz-main'}>
      {!projectId ? <section className={chat.chat}>
        <div className="window-header"><div className="window-header-title"><div className="window-header-main-title">所有项目</div><div className="window-header-sub-title">{PROJECTS_ROOT}</div></div></div>
        <div className={chat['chat-main']}><div className={chat['chat-body-container']}>
          <div className={chat['chat-body'] + ' tz-chat-body tz-project-home'}><div className="tz-welcome"><div className="tz-home-emblem"><img src={brandMark} alt="" /></div><span className="tz-welcome-kicker">你的本地协作空间</span><h1>把想法，推进成结果。</h1><p>每个项目都有独立的对话、资料与记忆。<br />选择一个项目继续，或为新想法创建工作空间。</p>{projects.length > 0 && <div className="tz-home-projects" aria-label="最近项目">{projects.slice(0, 4).map((project) => <button key={project.id} aria-label={'打开项目 ' + project.name} onClick={() => void openProject(project.id)}><Icon name="folder" /><span><strong>{project.name}</strong><small>{new Date(project.createdAt).toLocaleDateString('zh-CN')} 创建</small></span><span aria-hidden="true">↗</span></button>)}</div>}</div></div>
          <form className={chat['chat-input-panel'] + ' tz-home-fields'} onSubmit={(event) => { event.preventDefault(); void createProject(); }}>
            {error && <p role="alert" className="nc-error">{error}</p>}
            <div className={chat['chat-input-panel-inner'] + ' tz-compose-field'}><input id="nc-project-name" className={chat['chat-input'] + ' nc-project-name'} value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="项目名称，例如：写论文" aria-label="项目名称" maxLength={80} autoComplete="off" /></div>
            <IconButton icon="add" text="创建项目" type="primary" buttonType="submit" className={chat['chat-input-send'] + ' tz-send'} disabled={busy || !newProjectName.trim()} />
          </form>
        </div></div>
      </section> : !snapshot ? <div className={home['loading-content']}>正在打开 {projectId}…</div> : showProviders ? <section className={chat.chat}>
        <div className="window-header"><div className="window-header-title"><div className="window-header-main-title">设置</div><div className="window-header-sub-title">智能体管理与中转站 · v{window.cth.version}</div></div><div className="window-actions"><IconButton icon="close" title="关闭设置" bordered onClick={() => setShowProviders(false)} /></div></div>
        <div className={settings.settings + ' tz-settings'}><ProviderPanel key={projectId} projectId={projectId} providers={snapshot.providers} agents={snapshot.agents} initialProviderId={settingsProviderId} onSaved={async () => { modelCacheRef.current.clear(); await refresh(); }} /></div>
      </section> : <section className={chat.chat}>
        <div className="window-header tz-conversation-header">
          <div className="tz-header-identity"><AgentAvatar id={privateAgentId || 'workgroup'} /><div className={'window-header-title ' + chat['chat-body-title']}><div className={'window-header-main-title ' + chat['chat-body-main-title']} onClick={() => { if (conversationId === 'workgroup') { setWorkgroupNameDraft(workgroup?.name ?? '总工作群'); setEditingWorkgroup(true); } }}>{currentTitle}</div><div className="window-header-sub-title">{isGroupConversation ? <span>{groupAgents.length} 位成员<span className="tz-meta-dot">·</span></span> : <span>独立对话<span className="tz-meta-dot">·</span></span>}<span>共 {messages.length} 条对话</span></div></div></div>
          <div className="window-actions">
            {isGroupConversation && <div className="tz-header-faces" aria-hidden="true">{groupAgents.slice(0, 5).map((agent) => <AgentAvatar key={agent.id} id={agent.id} />)}</div>}
            {isGroupConversation && <button className="tz-header-members" aria-label={membersCollapsed ? '展开伙伴栏' : '收起伙伴栏'} aria-expanded={!membersCollapsed} onClick={() => setMembersCollapsed((value) => !value)}><Icon name="members" /><span>成员</span></button>}
            <IconButton icon="folder" text="科研工作台" title="科研工作台" onClick={() => setSidebarPage('research')} />
            <ToolMenu>
              <div className="tz-menu-label">阅读方式</div><div className="tz-view-switch" role="group" aria-label="消息显示样式"><button aria-label="气泡样式" aria-pressed={messageView === 'bubble'} onClick={() => setMessageView('bubble')}>气泡</button><button aria-label="文稿样式" aria-pressed={messageView === 'document'} onClick={() => setMessageView('document')}>文稿</button></div>
              <IconButton icon="history" text="聊天日期" onClick={() => setShowHistory(true)} />
              <IconButton icon="rename" text={conversationId === 'workgroup' ? '重命名总工作群' : '会话设置'} onClick={() => { if (conversationId === 'workgroup') { setWorkgroupNameDraft(workgroup?.name ?? '总工作群'); setEditingWorkgroup(true); } else if (privateAgent) setShowChatSettings(true); else setShowNewChat(true); }} />
              <IconButton icon="share" text="导出聊天" onClick={() => setShowExport(true)} />
              <IconButton icon="reload" text="刷新聊天" disabled={busy} onClick={() => void refresh().catch((cause) => setError(String(cause)))} />
              <div className="tz-menu-label">工作空间</div><IconButton icon="plugin" text="普通任务与文件交接" onClick={() => setSidebarPage('tasks')} /><IconButton icon="light" text="调整字体和背景" onClick={() => setShowAppearance(true)} />
              <IconButton icon="image" text="聊天背景" onClick={() => setShowChatBackground(true)} />
              <button className="tz-motion-toggle" aria-label="伙伴动效" aria-pressed={pixelMotion} onClick={() => setPixelMotion((value) => !value)} title="头像装饰动效，不表示模型运行状态">头像装饰动效<span>{pixelMotion ? '已开启' : '已关闭'}</span></button>
              <IconButton icon={focusMode ? 'min' : 'max'} text={focusMode ? '退出专注' : '专注聊天'} onClick={() => setFocusMode((value) => !value)} />
            </ToolMenu>
          </div>
        </div>
        <div className="tz-members" aria-label="会话成员" data-collapsed={membersCollapsed}><button className="tz-members-toggle" aria-label={membersCollapsed ? '展开伙伴栏' : '收起伙伴栏'} aria-expanded={!membersCollapsed} onClick={() => setMembersCollapsed((value) => !value)}><span className="tz-members-chevron">⌄</span><strong>伙伴</strong><small>{isGroupConversation ? groupAgents.length : 1}</small></button><div className="tz-members-cards">{(isGroupConversation ? groupAgents : privateAgent ? [privateAgent] : []).map((agent) => {
          const reply = runReplies.find((item) => item.senderId === agent.id);
          const status = currentRun?.agentIds.includes(agent.id) ? (reply ? reply.status === 'error' ? '回复失败' : '已回复' : currentRun.phase === 'sending' ? '准备发送' : currentRun.sequential && agent.id !== waitingAgentId ? '排队中' : currentStreams.some((stream) => stream.agentId === agent.id) ? '正在输出' : '等待回复') : currentRun ? '本轮未@' : agent.enabled ? '可参与' : '未启用';
          return <div key={agent.id} className={'tz-member' + (agent.enabled ? '' : ' tz-member-disabled')} data-state={status} style={agentStyle(agent.id)}><AgentAvatar id={agent.id} animated={pixelMotion} /><div><strong>{agent.displayName}</strong><span>{status}</span></div></div>;
        })}</div><span className="tz-members-hint">{currentRun ? currentRun.sequential ? (waitingAgent?.displayName ?? '') + ' 回复中' : '同时回复中' : '由你决定谁发言'}</span></div>
        <div className={chat['chat-main']}><div className={chat['chat-body-container']}>
          <div ref={chatBodyRef} className={chat['chat-body'] + ' tz-chat-body'} aria-label="聊天消息" data-photo={Boolean(chatBackground)} style={chatBackground ? { backgroundImage: `linear-gradient(var(--photo-overlay), var(--photo-overlay)), url("${chatBackground}"), url("${chatBackground}")`, backgroundSize: '100% 100%, contain, cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', backgroundColor: 'var(--panel)' } : undefined} onScroll={(event) => { const body = event.currentTarget; stickToBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 100; }}>
            {messages.length === 0 && <div className="tz-welcome"><span className="tz-welcome-kicker">一个目标，多种可能</span><div className="tz-welcome-crew">{(isGroupConversation ? groupAgents : privateAgent ? [privateAgent] : []).map((agent) => <AgentAvatar key={agent.id} id={agent.id} animated={pixelMotion} />)}</div><h2>{isGroupConversation ? '从一个好问题开始。' : '你好，' + privateAgent?.displayName + '。'}</h2><p>{isGroupConversation ? '把想法发在这里，邀请合适的智能体一起推进。' : '当前模型可在下方“模型设置”中自由调整。'}</p></div>}
            {visibleMessages.length > 0 && <div className="tz-date-divider">{selectedDate}</div>}
            {visibleMessages.length === 0 && messages.length > 0 && <p className="nc-hint">{selectedDate} 没有消息。可以在聊天日期中查看其他记录。</p>}
            {visibleMessages.map((item) => <MessageBubble key={item.id} message={item} agents={snapshot.agents} projectRoot={snapshot.projectRoot} onOpenImageStudio={() => setShowImageStudio(true)} onSetBackground={setChatBackground} delivery={failedDelivery[item.id] || (currentRun?.messageId === item.id && currentRun.phase === 'sending' ? '正在发送' : undefined)} />)}
            {currentStreams.map((currentStream) => <MessageBubble key={'stream-' + currentStream.inReplyTo + currentStream.agentId} message={{ id: 'stream-' + currentStream.inReplyTo, projectId, conversationId, senderId: currentStream.agentId, channel: isGroupConversation ? conversationId === 'workgroup' ? 'workgroup' : 'group' : 'private', content: currentStream.content, createdAt: '' }} agents={snapshot.agents} streaming />)}
            {currentRun && pendingAgents.map((agent) => {
              const streaming = currentStreams.some((stream) => stream.agentId === agent.id);
              const image = agentApiMode(agent.model || snapshot.providers.find((provider) => provider.id === agent.providerId)?.defaultModel || '', agent.apiMode) === 'image';
              return <div key={agent.id} className="tz-live-reply" role="status" aria-live="polite" style={agentStyle(agent.id)}><div className="tz-live-orbit"><AgentAvatar id={agent.id} animated={pixelMotion} /></div><div><strong>{currentRun.phase === 'sending' ? '正在保存你的消息' : image ? agent.displayName + ' 等待生图确认' : streaming ? agent.displayName + ' 正在输出' : '等待 ' + agent.displayName + ' 回复'}</strong><span>{image ? '生图必须由你确认后才会调用接口' : <>本轮已处理 {runReplies.length} / {currentRun.agentIds.length} 位伙伴 · {currentRun.sequential ? '依次回复' : '同时接收'} · 回复后立即显示</>}</span></div><div className="tz-typing-dots" aria-hidden="true"><i /><i /><i /></div></div>;
            })}
          </div>
          <div className={chat['chat-input-panel'] + ' tz-composer'} data-collapsed={composerCollapsed}><div className="tz-composer-inner">
            <div className="nc-composer-drag" role="separator" aria-orientation="horizontal" aria-label="调整输入区高度" onPointerDown={(event) => beginResize('y', composerHeight, event)} />
            <div className="tz-composer-toolbar">
              {isGroupConversation ? <MentionPicker key={projectId + ':' + conversationId} agents={groupAgents} all={mentionAll} selected={mentionAgentIds} onChange={(all, ids) => { setMentionAll(all); setMentionAgentIds(ids); setSpeakerOrder(''); }} onOrder={() => setShowMentions(true)} /> : <IconButton icon="chat-settings" text="模型设置" title="模型设置" onClick={() => setShowChatSettings(true)} />}
              <IconButton icon="image" text={'生图' + (snapshot.imageStudio?.jobs.some((job) => job.status === 'pending') ? ' · 待确认' : '')} title="生图工作室" onClick={() => setShowImageStudio(true)} />
              <div className="tz-toolbar-spacer" />
              {isGroupConversation && <span className="tz-compose-note">仅受邀成员回复</span>}
              <IconButton icon="max" title="放大编辑框" onClick={() => setExpandedEditor(true)} />
              <IconButton icon={composerCollapsed ? 'up' : 'down'} title={composerCollapsed ? '展开输入区' : '收起输入区'} onClick={() => setComposerCollapsed((value) => !value)} />
            </div>
            {isGroupConversation && <div className="tz-recipient-summary"><span>{speakerOrder ? '发言顺序：' + speakerOrder : '发言方式：同时接收，谁先完成谁先回复'}</span><button onClick={() => setShowMentions(true)}>{speakerOrder ? '调整' : '指定顺序'}</button></div>}
            {error && <p role="alert" className="nc-error">{error}</p>}
            {busy && !currentRun && <div className="nc-hint" role="status">正在执行操作…</div>}
            <div className={chat['chat-input-panel-inner'] + ' tz-compose-field'}><textarea className={chat['chat-input']} style={{ height: composerHeight }} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={isGroupConversation ? '发送消息，召集你的智能体…' : '给 ' + (privateAgent?.displayName ?? '助手') + ' 发消息…'} aria-label="消息输入框" /><IconButton icon="send-white" text="发送" type="primary" className={chat['chat-input-send'] + ' tz-send'} onClick={() => void send()} disabled={busy || !message.trim()} /></div>
            <div className="tz-composer-footnote">Enter 发送 · Shift + Enter 换行<span>AI 输出请结合证据核实</span></div>
          </div>
          </div>
        </div></div>
      </section>}
    </main>
      {showImageStudio && snapshot && <Modal title="生图工作室" onClose={() => setShowImageStudio(false)}><ImageStudioPanel snapshot={snapshot} conversationId={conversationId} requesterId={privateAgentId || groupAgents.find((agent) => agent.enabled && agent.id !== snapshot.imageStudio?.defaultAgentId)?.id} onSaved={refresh} onOpenAgent={(id) => { const agent = snapshot.agents.find((item) => item.id === id); if (agent) { selectPrivate(agent); setChatProviderDraft(agent.providerId); setChatModelDraft(agent.model || ''); setChatEffortDraft(agent.reasoningEffort || 'default'); setChatApiModeDraft(agent.apiMode ?? 'auto'); setShowImageStudio(false); setShowChatSettings(true); } }} /></Modal>}
    {showChatBackground && snapshot && <Modal title="聊天背景" onClose={() => setShowChatBackground(false)}><ChatBackgroundPanel key={projectId + ':' + conversationId} projectId={projectId} conversationId={conversationId} title={currentTitle} imageUrl={chatBackground} onSaved={refresh} /></Modal>}
    {showCapabilities && snapshot && <Modal title="能力与权限" onClose={() => setShowCapabilities(false)}><CapabilitiesPanel snapshot={snapshot} /></Modal>}

    {showAbout && <Modal title="关于星枢" onClose={() => setShowAbout(false)}><List><ListItem title="星枢 · XINGSHU" subTitle="本地桌面多智能体协作"><span>中文界面</span></ListItem><ListItem title="界面来源" subTitle="NextChat · MIT · 1d3dc33"><span>本地适配组件与样式</span></ListItem><ListItem title="本地数据目录"><code>{PROJECTS_ROOT}</code></ListItem></List><p className="nc-hint">本软件为独立改造版本。保留 NextChat 与 Munder Difflin 的开源许可；不连接 NextChat 云服务。</p><p className="nc-hint">Q 版角色：fywdy · 社区非官方同人，非模型厂商形象。美术素材采用 CC BY-NC 4.0，仅限非商业使用；本地头像经过裁切。<a href="https://github.com/fywdy/chatgpt-chibi-pets" target="_blank" rel="noreferrer noopener">查看素材来源与声明</a></p></Modal>}
    {showShortcuts && <Modal title="快捷键" onClose={() => setShowShortcuts(false)}><List><ListItem title="发送消息"><kbd>Enter</kbd></ListItem><ListItem title="输入换行"><kbd>Shift + Enter</kbd></ListItem><ListItem title="关闭弹窗"><kbd>Esc</kbd></ListItem></List></Modal>}
    {showExport && <Modal title="导出聊天" onClose={() => setShowExport(false)}><p className="nc-hint">当前日期的消息以 Markdown 导出；复制后可保存在项目资料中。</p><textarea className="nc-export-preview" aria-label="聊天导出预览" readOnly value={visibleMessages.map((item) => '## ' + (item.senderId === 'human' ? '你' : snapshot?.agents.find((agent) => agent.id === item.senderId)?.displayName ?? item.senderId) + '\n\n' + (item.status === 'error' ? item.error ?? '' : item.content)).join('\n\n')} /><IconButton text="复制 Markdown" icon="copy" type="primary" onClick={() => { void navigator.clipboard.writeText(visibleMessages.map((item) => '## ' + (item.senderId === 'human' ? '你' : snapshot?.agents.find((agent) => agent.id === item.senderId)?.displayName ?? item.senderId) + '\n\n' + (item.status === 'error' ? item.error ?? '' : item.content)).join('\n\n')); }} /></Modal>}
    {showAppearance && <Modal title="外观设置" onClose={() => setShowAppearance(false)}><AppearancePanel value={appearance} onChange={setAppearance} onOpenChatBackground={snapshot ? () => { setShowAppearance(false); setShowChatBackground(true); } : undefined} /></Modal>}
    {expandedEditor && <Modal title="放大编辑" onClose={() => setExpandedEditor(false)}><textarea className="tz-expanded-editor" aria-label="放大消息编辑框" placeholder="在这里编辑长消息…" value={message} onChange={(event) => setMessage(event.target.value)} /><div className="nc-button-row"><IconButton text="完成编辑" bordered onClick={() => setExpandedEditor(false)} /><IconButton icon="send-white" text="发送这条消息" type="primary" disabled={busy || !message.trim()} onClick={() => { setExpandedEditor(false); void send(); }} /></div></Modal>}
    {snapshot && <>
      {showNewChat && <Modal title="新的聊天" onClose={() => setShowNewChat(false)}><List>
        <ListItem title="搜索会话"><IconButton icon="discovery" text="搜索" bordered onClick={() => { setShowNewChat(false); setShowSearch(true); }} /></ListItem>
        <ListItem title="创建群聊" subTitle="自己选择群成员"><IconButton icon="add" text="创建" bordered onClick={() => { setShowNewChat(false); setShowCreateGroup(true); }} /></ListItem>
        <ListItem title="添加助手" subTitle="名称与实际模型可以分别配置"><IconButton icon="add" text="添加" bordered onClick={() => { setShowNewChat(false); setShowCreateAgent(true); }} /></ListItem>
        {snapshot.agents.map((agent) => <ListItem key={agent.id} title={agent.displayName}><IconButton icon="chat" text="开始聊天" bordered onClick={() => { selectPrivate(agent); setShowNewChat(false); setShowProviders(false); }} /></ListItem>)}
      </List></Modal>}
      {showCreateGroup && <Modal title="创建群聊" onClose={() => setShowCreateGroup(false)}><form className="nc-form" onSubmit={(event) => { event.preventDefault(); void createGroup(); }}><label>群聊名称<input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={80} placeholder="填写群聊名称" /></label><List>{snapshot.agents.map((agent) => <ListItem key={agent.id} title={agent.displayName}><input type="checkbox" checked={groupMembers.includes(agent.id)} onChange={() => setGroupMembers((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])} aria-label={'选择 ' + agent.displayName} /></ListItem>)}</List><IconButton text="创建群聊" icon="add" type="primary" buttonType="submit" disabled={busy || !groupName.trim() || !groupMembers.length} />{error && <p className="nc-error" role="alert">{error}</p>}</form></Modal>}
      {showCreateAgent && <Modal title="新建智能体" onClose={() => setShowCreateAgent(false)}><form className="nc-form" onSubmit={(event) => { event.preventDefault(); void createAgent(); }}><List><ListItem title="智能体名称"><input value={newAgentName} onChange={(event) => setNewAgentName(event.target.value)} maxLength={80} placeholder="例如：论文研究员" /></ListItem><ListItem title="中转站"><select aria-label="新智能体中转站" value={newAgentProviderId} onChange={(event) => { setNewAgentProviderId(event.target.value); setNewAgentModel(''); }}><option value="">请选择已保存的中转站</option>{snapshot.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></ListItem><ListItem title="模型" subTitle="直接选择中转站里配好的模型"><select aria-label="新智能体模型" disabled={!newAgentProviderId} value={newAgentModel} onChange={(event) => setNewAgentModel(event.target.value)}><option value="">请选择模型</option>{relayModels(snapshot.providers.find((provider) => provider.id === newAgentProviderId), snapshot.agents).map((model) => <option key={model} value={model}>{model}</option>)}</select></ListItem></List><IconButton type="primary" icon="add" text="创建智能体" buttonType="submit" disabled={busy || !newAgentName.trim() || !newAgentProviderId || !newAgentModel.trim()} />{error && <p className="nc-error" role="alert">{error}</p>}</form></Modal>}
      {editingWorkgroup && <Modal title="重命名总工作群" onClose={() => setEditingWorkgroup(false)}><form className="nc-form" onSubmit={(event) => { event.preventDefault(); void renameWorkgroup(); }}><label>群名称<input value={workgroupNameDraft} onChange={(event) => setWorkgroupNameDraft(event.target.value)} maxLength={80} /></label><IconButton type="primary" text="保存" buttonType="submit" disabled={busy || !workgroupNameDraft.trim()} />{error && <p className="nc-error" role="alert">{error}</p>}</form></Modal>}
      {showMentions && <Modal title="本轮发言设置" onClose={() => setShowMentions(false)}><List>
        <ListItem title="@全体" subTitle="默认同时接收；需要依次发言时再指定顺序"><input type="checkbox" aria-label="@全体" checked={mentionAll} onChange={() => { const next = !mentionAll; setMentionAll(next); setMentionAgentIds([]); setSpeakerOrder(''); }} /></ListItem>
        {groupAgents.map((agent) => <ListItem key={agent.id} title={'@' + agent.displayName}><input type="checkbox" aria-label={'@' + agent.displayName} checked={mentionAgentIds.includes(agent.id)} disabled={mentionAll || !agent.enabled} onChange={() => setMentionAgentIds((current) => { const next = current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id]; setSpeakerOrder(''); return next; })} /></ListItem>)}
        <ListItem title="发言顺序（可选）" subTitle="留空同时接收，谁先完成谁先回复；填写后严格依次发言"><input aria-label="发言顺序" value={speakerOrder} onChange={(event) => setSpeakerOrder(event.target.value)} placeholder="留空同时回复；指定时完整填写名称，用顿号分隔" /></ListItem><ListItem title="本轮职责" subTitle="只作用于当前消息，不固定身份"><input value={runtimeRole} onChange={(event) => setRuntimeRole(event.target.value)} placeholder="可选，由你决定" /></ListItem>
      </List><div className="nc-button-row"><IconButton text="恢复同时回复" bordered onClick={() => setSpeakerOrder('')} /><IconButton text="运行当前群" icon="reload" bordered disabled={busy || !isGroupConversation} onClick={() => { setShowMentions(false); void runCycle(); }} /><IconButton text="完成" type="primary" onClick={() => setShowMentions(false)} /></div></Modal>}
      {showHistory && <Modal title="聊天日期" onClose={() => setShowHistory(false)}><List><ListItem title="查看日期" subTitle="只筛选显示，不删除历史和记忆"><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="聊天日期" /></ListItem></List><IconButton text="完成" type="primary" onClick={() => setShowHistory(false)} /></Modal>}
      {showChatSettings && privateAgent && <Modal title={privateAgent.displayName + ' · 模型设置'} onClose={() => setShowChatSettings(false)}><p className="tz-dialog-intro">{privateAgent.displayName} 是伙伴昵称。实际模型自由选择，私聊和群聊共用此设置。</p><List>
        <ListItem title="中转站"><select value={chatProviderDraft} onChange={(event) => { setChatProviderDraft(event.target.value); setChatModelDraft(''); setChatApiModeDraft('agent'); setAvailableModels([]); }}>{snapshot.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></ListItem>
        <ListItem title="接口与密钥" subTitle="每个中转站分别配置，不要求使用相同地址"><IconButton text="编辑接口与密钥" bordered onClick={() => { setSettingsProviderId(chatProviderDraft || privateAgent.providerId); setShowChatSettings(false); setShowProviders(true); }} /></ListItem>
        <AgentApiModePicker model={chatModelDraft || snapshot.providers.find((provider) => provider.id === chatProviderDraft)?.defaultModel || ''} value={chatApiModeDraft} onChange={setChatApiModeDraft} />
        <ListItem title="推理强度" subTitle="智能体与兼容聊天模式会发送；生图不发送此参数"><select value={chatEffortDraft} onChange={(event) => setChatEffortDraft(event.target.value as ReasoningEffort)}>{[['default', '默认'], ['minimal', '最少'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '极高'], ['max', '最大']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></ListItem>
      <ListItem title="本轮职责" subTitle="只作用于发送消息，不保存为固定身份"><input value={runtimeRole} onChange={(event) => setRuntimeRole(event.target.value)} placeholder="可选，由你决定" /></ListItem></List><ModelPicker key={chatProviderDraft} value={chatModelDraft} onChange={(model) => { setChatModelDraft(model); setChatApiModeDraft(modeForModel(model, chatApiModeDraft)); }} models={relayModels(snapshot.providers.find((provider) => provider.id === chatProviderDraft), snapshot.agents, availableModels)} loading={modelsLoading} error={modelLoadError} onReload={() => void loadModels(true)} /><div className="nc-button-row tz-model-footer"><IconButton text="读取可用模型" icon="reload" bordered onClick={() => void loadModels(true)} disabled={modelsLoading} /><IconButton text="保存设置" type="primary" onClick={() => void saveChatAgent()} disabled={busy} /></div>{error && <p role="alert" className="nc-error">{error}</p>}</Modal>}
      <TaskWorkspace key={projectId} open={sidebarPage === 'tasks'} projectId={projectId} snapshot={snapshot} assignee={selectedAgent} onAssigneeChange={setSelectedAgent} busy={busy} onBusyChange={setBusy} onRefresh={refresh} onClose={() => setSidebarPage('chats')} />
      <ResearchWorkspace key={'research:' + projectId} open={sidebarPage === 'research'} projectId={projectId} snapshot={snapshot} busy={busy} onBusyChange={setBusy} onRefresh={refresh} onClose={() => setSidebarPage('chats')} />
    </>}
  </div></div></AgentVisualProvider>;
}

function ProviderPanel({ projectId, providers, agents, initialProviderId, onSaved }: { projectId: string; providers: ProviderConfig[]; agents: ApiAgentConfig[]; initialProviderId: string; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState(providers);
  const [activeTab, setActiveTab] = useState<'agents' | 'providers'>(initialProviderId ? 'providers' : 'agents');
  const [selectedProviderId, setSelectedProviderId] = useState(providers.some((item) => item.id === initialProviderId) ? initialProviderId : providers[0]?.id ?? '');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [headerText, setHeaderText] = useState<Record<string, string>>(() => Object.fromEntries(providers.map((provider) => [provider.id, JSON.stringify(provider.headers ?? {})])));
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelsLoading, setModelsLoading] = useState('');
  const [modelText, setModelText] = useState<Record<string, string>>(() => Object.fromEntries(providers.map((item) => [item.id, (item.models ?? []).join('\n')])));
  const update = (id: string, patch: Partial<ProviderConfig>) => setRows((all) => all.map((item) => item.id === id ? { ...item, ...patch } : item));
  const provider = rows.find((item) => item.id === selectedProviderId);
  const save = async (item: ProviderConfig): Promise<void> => {
    setSaving(true); setSaveError(''); setNotice('');
    try {
      const parsed = JSON.parse(headerText[item.id] || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求头必须是 JSON 对象');
      await window.cth.apiCollabSaveProvider({ ...item, models: (modelText[item.id] ?? '').split(/[\n,，]+/u).map((model) => model.trim()).filter(Boolean), headers: parsed as Record<string, string>, timeoutMs: Number(item.timeoutMs) || 120000, retryPolicy: { maxRetries: Number(item.retryPolicy?.maxRetries) || 0, backoffMs: Number(item.retryPolicy?.backoffMs) || 0 } });
      if (secrets[item.id]) { await window.cth.apiCollabSetSecret(item.id, secrets[item.id]); setSecrets((all) => { const next = { ...all }; delete next[item.id]; return next; }); }
      await onSaved(); setNotice('已保存中转站；其他连接保持不变。');
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const readModels = async (item: ProviderConfig) => {
    const stored = providers.find((candidate) => candidate.id === item.id);
    if (item.baseUrl !== stored?.baseUrl || secrets[item.id] || headerText[item.id] !== JSON.stringify(stored?.headers ?? {})) { setSaveError('请先保存接口地址、密钥和请求头，再读取模型列表'); return; }
    setModelsLoading(item.id); setSaveError(''); setNotice('');
    try {
      const models = await window.cth.apiCollabListModels(item.id);
      if (!models.length) throw new Error('中转站未返回模型。可在下方每行填一个它支持的模型 ID。');
      setModelText((current) => ({ ...current, [item.id]: [...new Set([...(current[item.id] ?? '').split('\n').filter(Boolean), ...models])].join('\n') }));
      setNotice(`已读取 ${models.length} 个模型；点击“保存中转站”后，智能体里即可直接选择。`);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setModelsLoading(''); }
  };
  return <>
    <div className="tz-settings-tabs" role="group" aria-label="设置分类"><button type="button" aria-pressed={activeTab === 'agents'} onClick={() => setActiveTab('agents')}>智能体管理</button><button type="button" aria-pressed={activeTab === 'providers'} onClick={() => setActiveTab('providers')}>中转站</button></div>
    <div hidden={activeTab !== 'agents'}><AgentManager projectId={projectId} agents={agents} providers={providers} onSaved={onSaved} onConnections={(id) => { setSelectedProviderId(id || rows[0]?.id || ''); setActiveTab('providers'); }} /></div>
    <div hidden={activeTab !== 'providers'} className="tz-connections-panel">
    <div className="tz-settings-intro"><h2>连接配一次，模型直接选。</h2><p>地址和密钥可供项目手动选用；智能体、记忆与外观仅属于当前项目。</p><span>本地加密保存 · {PROJECTS_ROOT}</span></div>
    <div className="nc-section-heading">中转站配置</div>
    <p className="nc-hint">每个连接单独保存接口地址和密钥，修改当前连接不会覆盖其他中转站。</p>
    <div className="tz-provider-grid" aria-label="独立中转站连接">{rows.map((item) => {
      const agent = agents.find((candidate) => candidate.providerId === item.id);
      return <button key={item.id} className="tz-provider-card" style={agentStyle(agent?.id ?? item.id)} aria-label={item.name + ' 连接设置'} aria-pressed={selectedProviderId === item.id} onClick={() => { setSelectedProviderId(item.id); setSaveError(''); setNotice(''); }}><AgentAvatar id={agent?.id ?? item.id} /><span className="tz-provider-card-copy"><strong>{item.name}</strong><small>{item.baseUrl ? '已填写接口' : '待填写接口'} · {providers.find((entry) => entry.id === item.id)?.hasSecret ? '密钥已保存' : '待填写密钥'}</small></span></button>;
    })}</div>
    <List><ListItem title="中转站" subTitle="每个助手可以使用不同中转站"><select aria-label="选择中转站" value={selectedProviderId} onChange={(event) => { setSelectedProviderId(event.target.value); setSaveError(''); setNotice(''); }}>{rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></ListItem>
    {provider && <>
      <ListItem title="接口地址" subTitle="填写中转站的 OpenAI 兼容接口地址"><input type="text" aria-label="中转站接口地址" value={provider.baseUrl} onChange={(event) => update(provider.id, { baseUrl: event.target.value })} placeholder="https://你的中转站/v1" autoComplete="off" /></ListItem>
      <ListItem title="API Key" subTitle="加密保存在 D 盘；留空保存不改变原密钥"><input type="password" aria-label="API Key" value={secrets[provider.id] ?? ''} onChange={(event) => setSecrets((all) => ({ ...all, [provider.id]: event.target.value }))} placeholder={providers.find((item) => item.id === provider.id)?.hasSecret ? '已保存，留空保持不变' : '在这里粘贴 API Key'} autoComplete="new-password" /></ListItem>
      <ListItem title="默认模型" subTitle="选用此中转站后可跟随默认，也可另选模型"><input type="text" aria-label="默认模型" value={provider.defaultModel} onChange={(event) => update(provider.id, { defaultModel: event.target.value })} /></ListItem>
      <ListItem title="可选模型" subTitle="每行一个准确模型 ID。保存后，智能体里直接下拉选择"><div className="tz-provider-models"><textarea aria-label="中转站可选模型" rows={4} value={modelText[provider.id] ?? ''} onChange={(event) => setModelText((current) => ({ ...current, [provider.id]: event.target.value }))} placeholder={'例如：中转站提供的文字模型或生图模型\n也可以点击下方按钮自动读取'} spellCheck={false} /><button type="button" disabled={saving || Boolean(modelsLoading)} onClick={() => void readModels(provider)}>{modelsLoading === provider.id ? '正在读取…' : '读取中转站模型列表'}</button><small>列表不保证密钥有调用权限，以中转站实际授权为准。</small></div></ListItem>
      <ListItem title="流式回复" subTitle="中转支持时边生成边显示；不支持时可以关闭"><input type="checkbox" aria-label="流式回复" checked={provider.stream === true} onChange={(event) => update(provider.id, { stream: event.target.checked })} /></ListItem>
      <ListItem title="启用中转站"><input type="checkbox" checked={provider.enabled} aria-label="启用中转站" onChange={(event) => update(provider.id, { enabled: event.target.checked })} /></ListItem>
    </>}</List>
    {provider && <><details className="nc-advanced"><summary>高级连接设置</summary><List>
      <ListItem title="Key 环境变量名" subTitle="可选；保留现有配置"><input type="text" value={provider.apiKeyRef} onChange={(event) => update(provider.id, { apiKeyRef: event.target.value })} /></ListItem>
      <ListItem title="请求超时（毫秒）"><input type="number" min={1000} value={provider.timeoutMs} onChange={(event) => update(provider.id, { timeoutMs: Number(event.target.value) })} /></ListItem>
      <ListItem title="最大重试次数" subTitle="用于聊天；生图失败不会自动重试，避免重复计费"><input type="number" min={0} max={5} value={provider.retryPolicy?.maxRetries ?? 2} onChange={(event) => update(provider.id, { retryPolicy: { ...provider.retryPolicy, maxRetries: Number(event.target.value) } })} /></ListItem>
      <ListItem title="重试间隔（毫秒）"><input type="number" min={0} value={provider.retryPolicy?.backoffMs ?? 500} onChange={(event) => update(provider.id, { retryPolicy: { ...provider.retryPolicy, backoffMs: Number(event.target.value) } })} /></ListItem>
      <ListItem title="额外请求头" subTitle="JSON 对象"><textarea aria-label="额外请求头" value={headerText[provider.id] ?? '{}'} onChange={(event) => setHeaderText((all) => ({ ...all, [provider.id]: event.target.value }))} /></ListItem>
    </List></details><div className="nc-button-row"><IconButton text="保存中转站" type="primary" onClick={() => void save(provider)} disabled={saving} /></div></>}
    {saveError && <p className="nc-error" role="alert">{saveError}</p>}{notice && <p className="nc-hint" role="status">{notice}</p>}
    </div>
  </>;
}

