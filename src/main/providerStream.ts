/** Read OpenAI-compatible SSE without waiting for the entire response body. */
export interface ProviderToolCall { id?: string; type?: string; function: { name: string; arguments: string } }
export async function readProviderStream(response: Response, onContent: (content: string) => void, onTools?: (tools: ProviderToolCall[]) => void): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('中转站未返回可读取的流');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let completed = false;
  let stopped = false;
  const tools = new Map<number, ProviderToolCall>();
  const line = (value: string): void => {
    if (!value.startsWith('data:')) return;
    const payload = value.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') { completed = true; stopped = true; return; }
    type Delta = { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
    let data: { error?: { message?: string }; choices?: Array<{ delta?: Delta; message?: Delta; finish_reason?: string | null }> };
    try { data = JSON.parse(payload); } catch { throw new Error('中转站返回了无效的流式 JSON'); }
    if (data.error) throw new Error(data.error.message || '中转站返回流式错误');
    const choice = data.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.message?.content;
    if (typeof delta === 'string') content += delta;
    for (const part of choice?.delta?.tool_calls ?? choice?.message?.tool_calls ?? []) {
      const index = part.index ?? 0;
      if (!Number.isInteger(index) || index < 0 || index > 19) throw new Error('流式工具请求数量无效');
      const call = tools.get(index) ?? { function: { name: '', arguments: '' } };
      if (part.id) call.id = part.id;
      call.function.name += part.function?.name ?? '';
      call.function.arguments += part.function?.arguments ?? '';
      if (call.function.arguments.length > 260000 || call.function.name.length > 200) throw new Error('流式工具参数过大');
      tools.set(index, call);
    }
    if (choice?.finish_reason) completed = true;
  };
  try {
    while (!stopped) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      const previous = content;
      for (const value of lines) { line(value.replace(/\r$/, '')); if (stopped) break; }
      if (chunk.done && buffer) { line(buffer.replace(/\r$/, '')); buffer = ''; }
      if (content !== previous) onContent(content);
      if (chunk.done) break;
    }
    if (!completed) throw new Error('流式连接提前断开，回复未完成，请重试');
    if (!content.trim() && !(onTools && tools.size)) throw new Error('中转站返回空内容');
    if (tools.size && onTools) onTools([...tools.entries()].sort(([a], [b]) => a - b).map(([, call]) => call));
    return content.trim();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
