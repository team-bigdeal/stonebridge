import { useState } from 'react';
import { ArrowLeft, ArrowUp, History } from 'lucide-react';
import type { TimelineItem } from '@shared/types';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useStore } from '@/store';
import { BrowserGrid, BrowserPanel } from './workspace/BrowserPanel';
import { HistoryCard, MailCard, RequirementsCard, UploadCard } from './cards/Basics';
import { CompareCard, DocsCard, ReportCard } from './cards/Compare';
import { api } from '@/lib/api';
import { exitReplay } from '@/replay';

/** 대화 하나로 이어지는 흐름 (AI Elements Conversation) */
export function Chat() {
  const { timeline, busy, stage, push, replay } = useStore();
  const [text, setText] = useState('');
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
        <ConversationContent className="mx-auto w-full max-w-[1760px] gap-5 px-6 py-6">
          {timeline.map((item) => (
            <Item key={item.id} item={item} />
          ))}
          {busy && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>생각하는 중…</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {replay ? (
        <div className="border-t bg-background/80 px-6 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-[1100px] items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3 text-[13px]">
            <History className="size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">지난 견적을 보는 중이에요. 견적서·원본은 볼 수 있고, 진행은 할 수 없어요.</span>
            <Button size="sm" className="ml-auto shrink-0" onClick={exitReplay}>
              <ArrowLeft className="size-4" /> 현재 견적으로
            </Button>
          </div>
        </div>
      ) : (
      <div className="border-t bg-background/80 px-6 py-4 backdrop-blur">
        <form
          className="mx-auto flex max-w-[1100px] items-end gap-2 rounded-2xl border bg-card p-2 focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={stage === 'interview' ? '예: 사무실 회의실에 롤스크린 블라인드 3개 설치하고 싶어요' : ['compare', 'questions', 'draft'].includes(stage) ? '바꿀 조건을 말하면 다시 검색할 수 있어요 (예: 5일 안에 받고 싶어요). 업체 URL을 붙여 넣어도 돼요' : '업체 사이트 URL을 붙여 넣으면 그 업체도 견적에 넣어요'}
            className="max-h-40 min-h-[44px] flex-1 resize-none border-0 bg-transparent text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={!text.trim()} className="size-10 rounded-xl">
            <ArrowUp className="size-5" />
          </Button>
        </form>
      </div>
      )}
    </div>
  );
}

const Wide = ({ children }: { children: React.ReactNode }) => <div className="w-full">{children}</div>;

function Item({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <Message from="user">
          <MessageContent className="whitespace-pre-wrap text-[14px]">{item.text}</MessageContent>
        </Message>
      );
    case 'assistant':
      return (
        <Message from="assistant">
          <MessageContent className="max-w-[900px] whitespace-pre-wrap text-[14px] leading-relaxed">{item.text}</MessageContent>
        </Message>
      );
    case 'requirements':
      return <Wide><div className="max-w-[1100px]"><RequirementsCard /></div></Wide>;
    case 'search':
    case 'vendors':
      return <Wide><BrowserGrid /></Wide>;
    case 'browser':
      return <Wide><div className="max-w-[1100px]"><BrowserPanel slot={item.slot} title={item.title} /></div></Wide>;
    case 'mail':
      return <Wide><div className="max-w-[900px]"><MailCard draft={item.draft} /></div></Wide>;
    case 'upload':
      return <Wide><div className="max-w-[900px]"><UploadCard vendorId={item.vendorId} /></div></Wide>;
    case 'compare':
      return <Wide><CompareCard /></Wide>;
    case 'docs':
      return <Wide><DocsCard /></Wide>;
    case 'report':
      return <Wide><div className="max-w-[1100px]"><ReportCard /></div></Wide>;
    case 'history':
      return <Wide><div className="max-w-[1100px]"><HistoryCard summary={item.summary} /></div></Wide>;
  }
}
