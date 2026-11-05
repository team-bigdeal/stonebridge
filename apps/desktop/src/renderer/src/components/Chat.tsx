import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, History, Loader2 } from 'lucide-react';
import type { TimelineItem } from '@shared/types';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageAction, MessageActions, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController
} from '@/components/ai-elements/prompt-input';
import arrowUp from '@/assets/figma/arrow-up.svg';
import { Mascot } from './Mascot';
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { cn } from '@/lib/utils';
import { BrowserGrid, BrowserPanel } from './workspace/BrowserPanel';
import { SizesCard } from './cards/Sizes';
import { HistoryCard, MailCard, MessageCard, RequirementsCard, UploadCard } from './cards/Basics';
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
  const { timeline, busy, replay, stage, runOf } = useStore();
  // 처음 그릴 때(또는 지난 견적을 열 때) 이미 있던 항목은 등장 애니메이션 없이, 이후 새로 붙는 항목만 살짝 미끄러져 들어온다
  const settled = useRef<Set<string>>(new Set());
  const replayId = replay?.id ?? null;
  const lastReplay = useRef<string | null | undefined>(undefined);
  if (lastReplay.current !== replayId) {
    lastReplay.current = replayId;
    settled.current = new Set(timeline.map((t) => t.id));
  }

  // 첫 화면: 아직 아무 말도 안 했으면 인사 대신 큰 환영 문구를 보여 준다
  const fresh = !replay && !busy && stage === 'interview' && timeline.length === 1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {fresh ? (
        <Hero />
      ) : (
        <Conversation className="min-h-0">
          <ConversationContent className="w-full gap-8 px-8 py-8">
            {/* 지금 견적의 요구 조건은 오른쪽 패널에서 보고 고친다. 대화에는 조건을 바꾸기 전 검색의 카드만 남긴다 */}
            {timeline.map((item) => (item.kind === 'requirements' && !runOf[item.id] ? null : <Item key={item.id} item={item} animate={!settled.current.has(item.id)} />))}
            {busy && (
              <div className="w-full animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                <Typing />
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {replay ? (
        <div className="bg-background px-8 py-3">
          <div className="flex animate-in items-center gap-3 rounded-lg bg-card px-5 py-4 text-[14px] fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
            <History className="size-5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">지난 견적을 보는 중이에요. 견적서와 원본은 볼 수 있지만 이어서 진행할 수는 없어요.</span>
            <Button className="ml-auto h-auto shrink-0 px-4 py-2.5 text-[14px]" onClick={exitReplay}>
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
    <div ref={box} className="bg-background px-8 pb-3 pt-2.5">
      <div className="space-y-3">
        {chips.length > 0 && (
          <Suggestions key={fresh ? 'examples' : 'follow-ups'} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
            {chips.map((c) => (
              <Suggestion
                key={c}
                suggestion={c}
                onClick={pick}
                variant="ghost"
                className="h-auto rounded-lg bg-card px-4 py-2.5 text-[14px] font-medium text-muted-foreground hover:bg-secondary hover:text-primary"
              />
            ))}
          </Suggestions>
        )}
        <PromptInput
          // 동기로 끝내야 PromptInput이 입력창을 바로 비운다 (Promise를 돌려주면 응답이 올 때까지 글자가 남음)
          onSubmit={({ text }) => {
            const t = text.trim();
            if (!t) return;
            push({ id: crypto.randomUUID(), kind: 'user', text: t });
            void api.sendChat(t).catch(() => {
              // 보내기에 실패하면 다시 보낼 수 있게 입력창에 되돌려 둔다 (그사이 새로 쓴 글이 있으면 건드리지 않음)
              if (!controller.textInput.value.trim()) controller.textInput.setInput(t);
            });
          }}
          // 디자인: 흰 입력칸 + 오른쪽 파란 보내기 버튼 (둘 사이 12px)
          className="[&>[data-slot=input-group]]:h-auto [&>[data-slot=input-group]]:items-stretch [&>[data-slot=input-group]]:gap-3 [&>[data-slot=input-group]]:overflow-visible [&>[data-slot=input-group]]:border-0 [&>[data-slot=input-group]]:shadow-none [&>[data-slot=input-group]]:ring-0!"
        >
          <PromptInputBody className="flex min-w-0 flex-1 items-center rounded-lg bg-card px-5 py-3 transition-shadow focus-within:ring-2 focus-within:ring-primary/30">
            <PromptInputTextarea
              autoFocus
              placeholder={
                fresh
                  ? '견적을 비교하고 싶은 상품을 입력해주세요'
                  : stage === 'interview'
                    ? '답변을 작성해주세요'
                    : '조건을 바꾸거나 업체 주소를 붙여 넣어 보세요'
              }
              className="min-h-0 p-0 py-1 text-[17px] font-medium leading-normal text-ink placeholder:text-muted-foreground md:text-[17px]"
            />
          </PromptInputBody>
          <PromptInputSubmit
            status={busy ? 'submitted' : undefined}
            disabled={empty || busy}
            aria-label="보내기"
            className="size-auto min-h-[50px] w-[58px] shrink-0 justify-center self-stretch rounded-lg bg-primary px-4 py-3 text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {/* 아이콘을 항상 26px 상자에 넣는다. svg가 버튼의 직계 자식이 되면 InputGroupButton의 has-[>svg]:p-0이
                padding을 없애 로딩 중에 버튼 폭이 확 줄어든다 */}
            <span className="flex size-[26px] shrink-0 items-center justify-center">
              {busy ? (
                <Loader2 className="size-[22px] animate-spin" />
              ) : (
                <img src={arrowUp} alt="" width={26} height={26} className="max-w-none shrink-0" />
              )}
            </span>
          </PromptInputSubmit>
        </PromptInput>
        {/* 처음 화면에서 아직 아무것도 안 썼을 때만 단축키 안내 */}
        {fresh && empty && <div className="px-1 text-right text-[12px] text-muted-foreground">Enter 보내기 · Shift+Enter 줄바꿈</div>}
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
    <div className="flex items-start gap-2" role="status">
      <Mascot size={42} />
      <div className="flex items-center gap-2.5 rounded-lg rounded-tl-none bg-card px-4 py-2.5 text-[16px] font-medium text-muted-foreground">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
        답을 정리하고 있어요
      </div>
    </div>
  );
}

/** 첫 화면 (Figma 29:398): 캐릭터 + 인사 두 줄 */
function Hero() {
  return (
    <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-8 py-8">
      <div className="mx-auto flex w-full max-w-[1174px] animate-in flex-col gap-8 pb-[6vh] fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
        <Mascot size={60} />
        <div className="flex flex-col gap-4 leading-normal">
          <p className="text-[24px] font-medium text-ink xl:text-[30px]">안녕하세요, 어떤 견적이 필요하세요?</p>
          <p className="text-[28px] font-semibold text-primary xl:text-[36px]">돌다리가 최적의 견적을 찾아드릴게요</p>
        </div>
      </div>
    </div>
  );
}

/** 대화 폭(읽기용)과 작업 폭(표·브라우저)을 나눈다 */
/** 메시지·카드 모두 좌우 폭을 다 쓴다 (어시스턴트는 왼쪽, 사용자는 오른쪽 끝으로) */
const Narrow = ({ children }: { children: React.ReactNode }) => <div className="w-full">{children}</div>;
const Medium = ({ children }: { children: React.ReactNode }) => <div className="w-full">{children}</div>;
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
          <Message from="user" className="max-w-[75%]">
            <MessageContent className="whitespace-pre-wrap text-[17px] font-medium leading-normal group-[.is-user]:rounded-lg group-[.is-user]:rounded-tr-none group-[.is-user]:bg-primary group-[.is-user]:px-5 group-[.is-user]:py-3 group-[.is-user]:text-white">{item.text}</MessageContent>
          </Message>
        </Narrow>
      );
    case 'assistant':
      return (
        <Narrow>
          <Message from="assistant" className="group/msg max-w-full">
            <div className="flex items-start gap-2">
              <Mascot size={42} />
              <div className="flex min-w-0 max-w-[85%] flex-col gap-1">
                <MessageContent className="whitespace-pre-wrap rounded-lg rounded-tl-none bg-card px-4 py-2.5 text-[17px] font-medium leading-normal group-[.is-assistant]:text-ink">{item.text}</MessageContent>
                <MessageActions className="opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 focus-within:opacity-100">
                  <CopyAction text={item.text} />
                </MessageActions>
              </div>
            </div>
          </Message>
        </Narrow>
      );
    case 'requirements':
      return <Medium><RequirementsCard /></Medium>;
    case 'sizes':
      return <Wide><SizesCard item={item.item} status={item.status} options={item.options} /></Wide>;
    case 'search':
      return <Wide><BrowserGrid /></Wide>;
    case 'vendors':
      return <Wide><BrowserGrid slots={item.slots} /></Wide>;
    case 'browser':
      // 보조 브라우저(사이즈 조사)는 좁고 낮게
      if (item.compact) return <div className="w-full max-w-[560px]"><BrowserPanel slot={item.slot} title={item.title} frameClassName="max-h-[300px]" /></div>;
      return <Medium><BrowserPanel slot={item.slot} title={item.title} /></Medium>;
    case 'mail':
      return <Narrow><MailCard draft={item.draft} /></Narrow>;
    case 'upload':
      return <Narrow>{item.message ? <MessageCard draft={item.message} /> : <UploadCard vendorId={item.vendorId} />}</Narrow>;
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
