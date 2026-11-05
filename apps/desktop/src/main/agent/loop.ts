// Claude tool use 루프. 슬롯(검색/업체)마다 독립 인스턴스.
import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { step } from '../events';
import { claude } from './claude';
import { runTool, TOOL_DEFS, type AgentOutcome, type ToolContext, type ToolName } from './tools';

export interface AgentTask {
  system: string;
  goal: string;
  tools: ToolName[];
  maxSteps?: number;
  /** 멈춤 신호 (사용자가 중단) */
  signal?: { aborted: boolean };
}

const TOOL_LABEL: Partial<Record<ToolName, string>> = {
  search_web: '검색',
  navigate: '이동',
  snapshot: '화면 읽기',
  read_text: '본문 읽기',
  click: '클릭',
  fill: '입력',
  select_option: '옵션 선택',
  expand_all: '펼치기',
  report_quote: '견적 기록',
  select_vendors: '업체 확정',
  claim_vendor: '업체 확정',
  switch_channel: '채널 전환',
  request_user: '사용자 확인 요청',
  handoff: '제출 직전 멈춤'
};

export async function runAgent(ctx: ToolContext, task: AgentTask): Promise<AgentOutcome> {
  const tools = task.tools.map((t) => TOOL_DEFS[t]);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.goal }];
  const maxSteps = task.maxSteps ?? 30;

  for (let i = 0; i < maxSteps; i++) {
    if (task.signal?.aborted) return { kind: 'incomplete' };
    const res = await claude().messages.create({
      model: config.model,
      max_tokens: 8000,
      system: task.system,
      tools,
      messages,
      output_config: { effort: config.effort },
      cache_control: { type: 'ephemeral' }
    });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'refusal') throw new Error('모델이 요청을 거절했습니다');

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) return { kind: 'incomplete' };

    const results: Anthropic.ToolResultBlockParam[] = [];
    let outcome: AgentOutcome | undefined;
    for (const use of uses) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input = use.input as any;
      const done = step(ctx.slot, TOOL_LABEL[use.name as ToolName] ?? use.name, input?.intent || use.name);
      const r = await runTool(ctx, use.name, input);
      done(r.isError ? 'error' : 'done', r.isError ? r.text.slice(0, 160) : undefined);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: r.text, is_error: r.isError });
      outcome ??= r.outcome;
    }
    messages.push({ role: 'user', content: results });
    if (outcome) return outcome;
  }
  return { kind: 'incomplete' };
}
