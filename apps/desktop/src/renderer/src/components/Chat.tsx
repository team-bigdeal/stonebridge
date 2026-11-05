import { useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, History } from 'lucide-react';
import type { TimelineItem } from '@shared/types';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store';
import { BrowserGrid, BrowserPanel } from './workspace/BrowserPanel';
import { HistoryCard, MailCard, RequirementsCard, UploadCard } from './cards/Basics';
import { CompareCard, DocsCard, ReportCard } from './cards/Compare';
import { api } from '@/lib/api';
import { exitReplay } from '@/replay';
import { RunContext } from '@/runScope';

const EXAMPLES = [
  '회의실에 롤스크린 블라인드 3개 설치하고 싶어요',
  '원형 방수 스티커 3000장, 예산 20만원, 10일 안에',
  '사무실 의자 12개 견적 비교해 줘'
];

/** 대화 하나로 이어지는 흐름 (AI Elements Conversation) */
export function Chat() {
  const { timeline, busy, stage, push, replay, runOf } = useStore();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fresh = timeline.length === 1 && stage === 'interview' && !replay;
  // 요구 조건 단계에서는 지금 견적의 확인 카드를 최신 메시지 바로 아래에 둔다 (위로 밀려 안 보이지 않게).
  // 조건을 바꾸기 전 검색의 카드(runOf)는 제자리에 둔다
  const liveReq = stage === 'interview' && !replay ? timeline.find((t) => t.kind === 'requirements' && !runOf[t.id]) : undefined;

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    push({ id: crypto.randomUUID(), kind: 'user', text: t });
    await api.sendChat(t);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[1440px] gap-6 px-8 py-8">
          {timeline.map((item) => (item === liveReq ? null : <Item key={item.id} item={item} />))}
          {liveReq && <Item key={liveReq.id} item={liveReq} />}
          {fresh && (
            <div className="mx-auto flex w-full max-w-[760px] flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setText(ex);
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg border bg-card px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          {busy && <div className="mx-auto w-full max-w-[760px]"><Typing /></div>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {replay ? (
        <div className="border-t bg-background px-8 py-4">
          <div className="mx-auto flex max-w-[760px] items-center gap-3 rounded-xl border bg-card px-4 py-3 text-[13px]">
            <History className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">지난 견적을 보는 중이에요. 견적서와 원본은 볼 수 있지만 이어서 진행할 수는 없어요.</span>
            <Button size="sm" className="ml-auto shrink-0" onClick={exitReplay}>
              <ArrowLeft className="size-3.5" /> 현재 견적으로
            </Button>
          </div>
        </div>
      ) : (
      <div className="border-t bg-background px-8 pb-4 pt-3">
        <form
          className="mx-auto flex max-w-[760px] items-end gap-2 rounded-xl border bg-card p-1.5 pl-3 transition-colors focus-within:border-primary/60"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            ref={inputRef}
            value={text}
            rows={1}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={stage === 'interview' ? '어떤 견적이 필요한지 적어 주세요' : '바꿀 조건을 말하면 다시 찾아볼게요 (예: 5일 안에 받고 싶어요). 업체 주소를 붙여 넣어도 돼요'}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={!text.trim()} aria-label="보내기" className="size-9 rounded-lg">
            <ArrowUp className="size-4" />
          </Button>
        </form>
        <p className="mx-auto mt-1.5 max-w-[760px] px-1 text-[11px] text-muted-foreground/70">Enter 보내기 · Shift+Enter 줄바꿈</p>
      </div>
      )}
    </div>
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
function Item({ item }: { item: TimelineItem }) {
  const run = useStore((s) => (s.runOf[item.id] ? s.runs[s.runOf[item.id]] : undefined));
  if (!run) return <ItemBody item={item} />;
  return (
    <RunContext.Provider value={run}>
      <ItemBody item={item} />
    </RunContext.Provider>
  );
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
          <Message from="assistant" className="max-w-full">
            <MessageContent className="whitespace-pre-wrap text-[15px] leading-7">{item.text}</MessageContent>
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
