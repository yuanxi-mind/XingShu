import { agentApiMode, type AgentApiMode } from '@shared/apiCollab';
import { ListItem } from './NextChat';

export function AgentApiModePicker({ model, value = 'agent', onChange }: { model: string; value?: AgentApiMode; onChange: (value: AgentApiMode) => void }) {
  const image = agentApiMode(model, value) === 'image';
  return <ListItem title="智能体运行配置" subTitle={image ? '生图模式：结果保存到当前项目。' : '工作模式支持规划、已接入工具和任务循环；兼容聊天为备用模式。'}>
    <select aria-label="智能体运行配置" value={value} onChange={(event) => onChange(event.target.value as AgentApiMode)}>
      <option value="agent">智能体工作模式{model ? image ? ' · 自动识别生图模型' : '' : ''}</option>
      <option value="auto">自动兼容模式</option>
      <option value="chat">兼容聊天模式</option>
      <option value="image">图片生成模式</option>
    </select>
  </ListItem>;
}
