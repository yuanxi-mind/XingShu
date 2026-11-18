import type { ProjectSnapshot } from '@shared/apiCollab';
import { agentApiMode } from '@shared/apiCollab';

export function CapabilitiesPanel({ snapshot }: { snapshot: ProjectSnapshot }) {
  return <div className="tz-capabilities">
    <p className="tz-capability-note">权限由本机程序提供，换模型不会自动增加工具。业务职责由你逐轮分配；模型名字不代表它的科研或写作水平。</p>
    <h3>当前助手</h3>
    <div className="tz-capability-agents">{snapshot.agents.map((agent) => {
      const provider = snapshot.providers.find((item) => item.id === agent.providerId);
      const image = agentApiMode(agent.model || provider?.defaultModel || '', agent.apiMode) === 'image';
      const compatibility = agent.apiMode === 'chat';
      return <div key={agent.id}><strong>{agent.displayName}</strong><span>{image ? '生图接口 · 逐次确认' : compatibility ? '兼容聊天模式' : '智能体编排 · 项目资料 · 任务流程'}</span><small>{!agent.enabled ? '未启用' : !provider?.enabled || !provider.baseUrl ? '未配置中转站' : !provider.hasSecret ? '缺少密钥' : '已配置 · 真实接口未在此测试'}</small></div>;
    })}</div>
    <h3>软件已接入</h3>
    <dl>
      <dt>聊天与发言控制</dt><dd>流式回复、悬停 @ 多选、指定顺序、群聊与私聊隔离。未被 @ 的助手不会执行本轮。</dd>
      <dt>换自己的头像 / 当前聊天背景</dt><dd>明确要求后，聊天模型可调用 <code>set_chat_appearance</code>，使用当前项目的共享图片；私聊还可使用自己的 data。PNG / JPEG / WebP，最多 10 MB。头像是全局身份外观，聊天背景按项目和会话保存。必须出现程序返回的“已执行”记录才算完成。</dd>
      <dt>申请新图片</dt><dd><code>request_image_generation</code> 只创建待确认申请。每次由你核对提示词、张数后才调用默认生图助手；不允许模型自己批准。</dd>
      <dt>任务与评审</dt><dd>任务面板支持依赖、运行时职责、文本结果、评审、有限返工与重启恢复。评审 / 监督等隔离调用不提供外观或生图工具。</dd>
      <dt>科研四盒与真实代码修改</dt><dd>“科研工作台”支持导入只读 baseline、多人独立提案、逐份授权开会、私人工作副本、精确改文件与自动备份、独立代码核查、登记服务器结果、由你确认实验、授权任意 Agent 发布版本。没有固定人数或固定业务角色。</dd>
      <dt>资料检索与工具循环</dt><dd>导入 baseline 后，聊天可按权限分段读取科研盒；私聊可检索 Crossref 近六个月论文元数据、GitHub 仓库和公开 HTTPS 文本/PDF。元数据不等于已读全文。科研操作最多 24 轮，工具失败有记录，不以文字假冒实际操作。</dd>
    </dl>
    <h3>资料与记忆的实际边界</h3>
    <p>共享位置：<code>WorkGroup/data</code>、<code>shared_context</code>、<code>code</code>、<code>artifacts</code>、<code>reports</code>。私聊只附加当前助手自己的 <code>AgentChats/助手ID/data</code>，其他助手默认不可读。</p>
    <p>常见文本、PDF 文本、DOCX 可提取；旧 DOC 依赖本机 pandoc。扫描 PDF 没有 OCR。单文件提取最多 6 万字符，每次文本最多 12 万字符，文件上限 20 MB；未指名的文本超过 1 MB 会跳过。图片最多 4 张，每张 4 MB、合计 8 MB，需要模型及中转支持视觉。</p>
    <p>聊天历史保存在本地，但每次请求只附加最近 12 条，并非无限记忆。不能保证零幻觉；论文事实、文献与实验分数仍须核验。</p>
    <p>科研盒另存于 <code>WorkGroup/research</code> 和每位 Agent 的 <code>boxes/materials、hypotheses、facts</code>。普通群聊不读取私人盒；共享方案只公开所选快照及其引用附件。实验事实绑定代码哈希、日志和你的确认；发布保留旧版，失败经验不替换当前代码。科研文件每段 3 万字符，可继续读；PDF/DOCX 上限 30 MB，图片须模型支持视觉。</p>
    <h3>尚未接入，不能假装完成</h3>
    <p>本机终端 / Python 和服务器实验执行、任意目录写入、扫描 PDF 的 OCR、自动导出 PDF / Word、助手自主批准实验或发布。服务器实验仍由你执行。</p>
    <h3>如何试一下</h3>
    <p>把图片放进 <code>WorkGroup/data</code>，私聊说：“把 WorkGroup/data/avatar.png 设为你的头像。”随后在总群悬停发言对象、选两位并发送问题，检查只有这两位回复；需要先后顺序时点“顺序与职责”。</p>
    <p className="tz-capability-note">真实科研、聊天和检索分析会调用你配置的 API，可能计费。界面打开、配置检查与本地模拟测试不调用真实中转。科研功能需要 tools 支持，不支持时会报错，不会假装执行。软件工具不允许改公共版本；你或系统管理员仍能在资源管理器改文件，哈希检查会阻止继续使用被改版本。</p>
  </div>;
}
