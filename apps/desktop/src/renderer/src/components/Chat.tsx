import { useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { TimelineItem } from '@shared/types';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store';
import { BrowserGrid, BrowserPanel } from './workspace/BrowserPanel';
import { MailCard, RequirementsCard, UploadCard } from './cards/Basics';
import { CompareCard, DocsCard, ReportCard } from './cards/Compare';

const EXAMPLES = [
  '회의실에 롤스크린 블라인드 3개 설치하고 싶어요',
  '원형 방수 스티커 3000장, 예산 20만원, 10일 안에',
  '사무실 의자 12개 견적 비교해 줘'
];

/** 대화 하나로 이어지는 흐름 (AI Elements Conversation) */
export function Chat() {
  const { timeline, busy, stage, push } = useStore();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fresh = timeline.length === 1 && stage === 'interview';

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText('');
    push({ id: crypto.randomUUID(), kind: 'user', text: t });
    await window.doldari.sendChat(t);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="min-h-0">
        <ConversationContent className="mx-auto w-full max-w-[1440px] gap-6 px-8 py-8">
          {timeline.map((item) => (
            <Item key={item.id} item={item} />
          ))}
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
            placeholder={stage === 'interview' ? '어떤 견적이 필요한지 적어 주세요' : '업체 사이트 주소를 붙여 넣으면 그 업체도 비교에 넣어요'}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-0 py-2 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={!text.trim()} aria-label="보내기" className="size-9 rounded-lg">
            <ArrowUp className="size-4" />
          </Button>
        </form>
        <p className="mx-auto mt-1.5 max-w-[760px] px-1 text-[11px] text-muted-foreground/70">Enter 보내기 · Shift+Enter 줄바꿈</p>
      </div>
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

function Item({ item }: { item: TimelineItem }) {
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
  }
}
