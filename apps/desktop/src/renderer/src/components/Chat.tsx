import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, History } from 'lucide-react';
import type { TimelineItem } from '@shared/types';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageAction, MessageActions, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController
} from '@/components/ai-elements/prompt-input';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import { BrowserGrid, BrowserPanel } from './workspace/BrowserPanel';
import { HistoryCard, MailCard, RequirementsCard, UploadCard } from './cards/Basics';
import { CompareCard, DocsCard, ReportCard } from './cards/Compare';
import { api } from '@/lib/api';
import { exitReplay } from '@/replay';
import { RunContext } from '@/runScope';

/** 처음 화면의 예시 요청 */
const EXAMPLES = [
  '회의실에 롤스크린 블라인드 3개 설치하고 싶어요',
  '원형 방수 스티커 3000장, 예산 20만원, 10일 안에',
  '사무실 의자 12개 견적 비교해 줘'
];
/** 비교가 끝난 뒤 조건을 바꿔 다시 찾을 때 자주 쓰는 말 (숫자는 고쳐서 보내면 된다) */
const FOLLOW_UPS = ['수량을 5000개로 바꿔서 다시 찾아 줘', '예산을 30만원으로 낮춰서 다시 찾아 줘', '5일 안에 받을 수 있는 곳으로 다시 찾아 줘'];

/** 대화 하나로 이어지는 흐름 (AI Elements Conversation · Message · PromptInput · Suggestion) */
export function Chat() {
  const { timeline, busy, replay } = useStore();
  // 처음 그릴 때(또는 지난 견적을 열 때) 이미 있던 항목은 등장 애니메이션 없이, 이후 새로 붙는 항목만 살짝 미끄러져 들어온다
  const settled = useRef<Set<string>>(new Set());
  const replayId = replay?.id ?? null;
  const lastReplay = useRef<string | null | undefined>(undefined);
  if (lastReplay.current !== replayId) {
    lastReplay.current = replayId;
    settled.current = new Set(timeline.map((t) => t.id));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[1440px] gap-6 px-8 py-8">
          {timeline.map((item) => (
            <Item key={item.id} item={item} animate={!settled.current.has(item.id)} />
          ))}
          {busy && (
            <div className="mx-auto w-full max-w-[760px] animate-in fade-in-0 duration-300 motion-reduce:animate-none">
              <Typing />
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {replay ? (
        <div className="border-t bg-background px-8 py-4">
          <div className="mx-auto flex max-w-[760px] animate-in items-center gap-3 rounded-xl border bg-card px-4 py-3 text-[13px] fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
            <History className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">지난 견적을 보는 중이에요. 견적서와 원본은 볼 수 있지만 이어서 진행할 수는 없어요.</span>
            <Button size="sm" className="ml-auto shrink-0" onClick={exitReplay}>
              <ArrowLeft className="size-3.5" /> 현재 견적으로
            </Button>
          </div>
        </div>
      ) : (
        <PromptInputProvider>
          <Composer />
        </PromptInputProvider>
      )}
    </div>
  );
}

/** 입력창 (AI Elements PromptInput) + 위쪽 제안 칩 (Suggestion) */
function Composer() {
  const { timeline, busy, stage, push } = useStore();
  const controller = usePromptInputController();
  const box = useRef<HTMLDivElement>(null);
  const fresh = timeline.length === 1 && stage === 'interview';
  const after = ['compare', 'questions', 'draft'].includes(stage) && !busy;
  const chips = fresh ? EXAMPLES : after ? FOLLOW_UPS : [];
  const empty = !controller.textInput.value.trim();

  const pick = (text: string) => {
    controller.textInput.setInput(text);
    // 숫자를 바로 고칠 수 있게 입력창에 포커스
    requestAnimationFrame(() => box.current?.querySelector('textarea')?.focus());
  };

  return (
    <div ref={box} className="border-t bg-background px-8 pb-4 pt-3">
      <div className="mx-auto max-w-[760px] space-y-2">
        {chips.length > 0 && (
          <Suggestions key={fresh ? 'examples' : 'follow-ups'} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            {chips.map((c) => (
              <Suggestion key={c} suggestion={c} onClick={pick} className="h-7 rounded-full px-3 text-[12px] font-normal text-muted-foreground hover:text-foreground" />
            ))}
          </Suggestions>
        )}
        <PromptInput
          onSubmit={async ({ text }) => {
            const t = text.trim();
            if (!t) return;
            push({ id: crypto.randomUUID(), kind: 'user', text: t });
            await api.sendChat(t);
          }}
          className="rounded-xl transition-colors"
        >
          <PromptInputBody>
            <PromptInputTextarea
              autoFocus
              placeholder={
                stage === 'interview'
                  ? '어떤 견적이 필요한지 적어 주세요'
                  : after
                    ? '바꿀 조건을 말하면 다시 찾아볼게요 (예: 5일 안에 받고 싶어요). 업체 주소를 붙여 넣어도 돼요'
                    : '업체 사이트 주소를 붙여 넣으면 그 업체도 비교에 넣어요'
              }
              className="min-h-11 text-[14px]"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <span className="px-1 text-[11px] text-muted-foreground/70">Enter 보내기 · Shift+Enter 줄바꿈</span>
            </PromptInputTools>
            <PromptInputSubmit status={busy ? 'submitted' : undefined} disabled={empty || busy} aria-label="보내기" />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

/** 어시스턴트 메시지 복사 (AI Elements MessageActions, 마우스를 올리면 보임) */
function CopyAction({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <MessageAction
      tooltip={done ? '복사했어요' : '복사'}
      label="메시지 복사"
      className="size-7 text-muted-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setDone(true));
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </MessageAction>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      답을 정리하고 있어요
    </div>
  );
}

/** 대화 폭(읽기용)과 작업 폭(표·브라우저)을 나눈다 */
const Narrow = ({ children }: { children: React.ReactNode }) => <div className="mx-auto w-full max-w-[760px]">{children}</div>;
const Medium = ({ children }: { children: React.ReactNode }) => <div className="mx-auto w-full max-w-[1100px]">{children}</div>;
const Wide = ({ children }: { children: React.ReactNode }) => <div className="w-full">{children}</div>;

/** 이전 검색에 속한 카드는 그 검색의 얼려 둔 상태로 그린다 */
function Item({ item, animate }: { item: TimelineItem; animate: boolean }) {
  const run = useStore((s) => (s.runOf[item.id] ? s.runs[s.runOf[item.id]] : undefined));
  // 새로 붙는 메시지·카드는 아래에서 8px 정도 부드럽게 올라오며 나타난다 (움직임 줄이기 설정이면 생략)
  const body = (
    <div className={cn(animate && 'animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none')}>
      <ItemBody item={item} />
    </div>
  );
  if (!run) return body;
  return <RunContext.Provider value={run}>{body}</RunContext.Provider>;
}

function ItemBody({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <Narrow>
          <Message from="user" className="max-w-[640px]">
            <MessageContent className="whitespace-pre-wrap text-[14px] leading-relaxed group-[.is-user]:rounded-2xl group-[.is-user]:px-4 group-[.is-user]:py-2.5">{item.text}</MessageContent>
          </Message>
        </Narrow>
      );
    case 'assistant':
      return (
        <Narrow>
          <Message from="assistant" className="group/msg max-w-full">
            <MessageContent className="whitespace-pre-wrap text-[15px] leading-7">{item.text}</MessageContent>
            <MessageActions className="-ml-1.5 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 focus-within:opacity-100">
              <CopyAction text={item.text} />
            </MessageActions>
          </Message>
        </Narrow>
      );
    case 'requirements':
      return <Medium><RequirementsCard /></Medium>;
    case 'search':
    case 'vendors':
      return <Wide><BrowserGrid /></Wide>;
    case 'browser':
      return <Medium><BrowserPanel slot={item.slot} title={item.title} /></Medium>;
    case 'mail':
      return <Narrow><MailCard draft={item.draft} /></Narrow>;
    case 'upload':
      return <Narrow><UploadCard vendorId={item.vendorId} /></Narrow>;
    case 'compare':
      return <Wide><CompareCard /></Wide>;
    case 'docs':
      return <Wide><DocsCard /></Wide>;
    case 'report':
      return <Medium><ReportCard /></Medium>;
    case 'history':
      return <Medium><HistoryCard summary={item.summary} /></Medium>;
  }
}
