'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMessage, mergeSnapshot } = require('./load-ts.cjs')('src/renderer/src/chatState.ts');
const empty = (projectId = 'project') => ({ projectId, workgroup: [], groupChats: {}, privateChats: {} });
const message = (id, extra = {}) => ({ id, projectId: 'project', channel: 'workgroup', senderId: 'human', content: id, ...extra });

test('optimistic echo and persisted event share one message; server fields win', () => {
  const optimistic = mergeMessage(empty(), message('1'));
  const accepted = mergeMessage(optimistic, message('1', { content: 'persisted' }));
  assert.equal(accepted.workgroup.length, 1);
  assert.equal(accepted.workgroup[0].content, 'persisted');
});

test('workgroup, groups, private agents, and projects remain isolated', () => {
  let state = mergeMessage(empty(), message('1'));
  state = mergeMessage(state, message('2', { channel: 'group', conversationId: 'research' }));
  state = mergeMessage(state, message('3', { channel: 'private', recipientId: 'gpt' }));
  state = mergeMessage(state, message('4', { channel: 'private', senderId: 'claude' }));
  assert.equal(mergeMessage(state, message('foreign', { projectId: 'other' })), state);
  assert.deepEqual(state.workgroup.map((x) => x.id), ['1']);
  assert.deepEqual(state.groupChats.research.map((x) => x.id), ['2']);
  assert.deepEqual(state.privateChats.gpt.map((x) => x.id), ['3']);
  assert.deepEqual(state.privateChats.claude.map((x) => x.id), ['4']);
});

test('snapshot fetched before live reply cannot remove it or duplicate ack', () => {
  const stale = mergeMessage(empty(), message('1', { content: 'server ack' }));
  const live = mergeMessage(mergeMessage(empty(), message('1')), message('2', { senderId: 'gpt' }));
  const merged = mergeSnapshot(stale, live);
  assert.deepEqual(merged.workgroup.map((x) => x.id), ['1', '2']);
  assert.equal(merged.workgroup[0].content, 'server ack');
  assert.equal(mergeSnapshot(empty('other'), live).workgroup.length, 0);
});
