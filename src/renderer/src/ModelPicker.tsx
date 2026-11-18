import { useState } from 'react';

export function ModelPicker({ value, onChange, models, loading, error, onReload }: { value: string; onChange: (value: string) => void; models: string[]; loading: boolean; error: string; onReload: () => void }) {
  const [query, setQuery] = useState('');
  const filtered = models.filter((model) => model.toLowerCase().includes(query.toLowerCase()));
  return <section className="tz-model-picker">
    <label htmlFor="tz-model-id">模型 ID <span>自由填写，不受智能体昵称限制</span></label>
    <input id="tz-model-id" aria-label="模型 ID" placeholder="填写模型 ID" value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} autoComplete="off" />
    <div className="tz-model-list-header"><strong>中转站模型 <span>{loading ? '读取中…' : models.length + ' 个'}</span></strong><button className="tz-text-button" disabled={loading} onClick={onReload}>{loading ? '正在读取' : '刷新列表'}</button></div>
    <input className="tz-model-search" aria-label="搜索中转模型" placeholder="搜索中转模型，例如 GPT、Claude、Gemini…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="tz-model-results" role="listbox" aria-label="中转站可用模型" aria-busy={loading}>
      {filtered.map((model) => <button key={model} type="button" role="option" aria-selected={value === model} onClick={() => onChange(model)}><span>{model}</span>{value === model && <small>已选择</small>}</button>)}
      {!filtered.length && <p>{loading ? '正在读取这个中转站的模型列表…' : query && models.length ? '没有匹配项；也可以在上方直接填写模型 ID。' : '列表暂不可用；在上方手动填写中转站支持的模型 ID 即可。'}</p>}
    </div>
    {error && <p className="nc-error" role="status">读取列表失败：{error}。仍可手动填写模型 ID。</p>}
    <p className="nc-hint">这里只展示当前中转站返回的列表。模型能否调用，还取决于你的密钥权限与中转分组。</p>
  </section>;
}
