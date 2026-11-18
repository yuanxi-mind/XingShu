import type { CollabMessage, ProjectSnapshot } from '@shared/apiCollab';

function upsert(messages: CollabMessage[], incoming: CollabMessage): CollabMessage[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index < 0) return [...messages, incoming];
  return messages.map((message, position) => position === index ? incoming : message);
}

export function mergeMessage(snapshot: ProjectSnapshot | null, message: CollabMessage): ProjectSnapshot | null {
  if (!snapshot || snapshot.projectId !== message.projectId) return snapshot;
  if (message.channel === 'workgroup') return { ...snapshot, workgroup: upsert(snapshot.workgroup, message) };
  if (message.channel === 'group' && message.conversationId) return { ...snapshot, groupChats: { ...snapshot.groupChats, [message.conversationId]: upsert(snapshot.groupChats[message.conversationId] ?? [], message) } };
  const owner = message.senderId === 'human' ? message.recipientId : message.senderId;
  if (message.channel === 'private' && owner) return { ...snapshot, privateChats: { ...snapshot.privateChats, [owner]: upsert(snapshot.privateChats[owner] ?? [], message) } };
  return snapshot;
}

// Message logs only append; keep events received while a snapshot was in flight.
export function mergeSnapshot(incoming: ProjectSnapshot, previous: ProjectSnapshot | null): ProjectSnapshot {
  if (!previous || previous.projectId !== incoming.projectId) return incoming;
  let result: ProjectSnapshot | null = incoming;
  const retained = [...previous.workgroup, ...Object.values(previous.privateChats).flat(), ...Object.values(previous.groupChats).flat()];
  const known = new Set([...incoming.workgroup, ...Object.values(incoming.privateChats).flat(), ...Object.values(incoming.groupChats).flat()].map((message) => message.id));
  for (const message of retained) if (!known.has(message.id)) result = mergeMessage(result, message);
  return result!;
}
