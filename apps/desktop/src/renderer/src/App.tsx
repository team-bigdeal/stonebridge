import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from './store';
import { Chat } from './components/Chat';
import { ExpandedBrowser, Notices, TopBar } from './components/Shell';
import { pushCursor, pushFrame } from './components/workspace/LiveFrame';
import { QuoteViewer } from './components/QuoteViewer';
import SettingsModal from './components/SettingsModal';
import { HistoryDetail, HistorySidebar } from './components/HistorySidebar';

export default function App() {
  const handle = useStore((s) => s.handle);
  const set = useStore((s) => s.set);

  useEffect(() => {
    window.doldari.config().then((c) => set({ config: c, settingsOpen: !c.hasApiKey, backend: c.browser }));
    const offEvent = window.doldari.onEvent(handle);
    const offFrame = window.doldari.onFrame(({ slot, data }) => pushFrame(slot, data));
    const offCursor = window.doldari.onCursor(pushCursor);
    return () => {
      offEvent();
      offFrame();
      offCursor();
    };
  }, [handle, set]);

  return (
    <TooltipProvider>
      <div className="dark flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <HistorySidebar />
          <main className="min-w-0 flex-1">
            <Chat />
          </main>
        </div>
        <ExpandedBrowser />
        <HistoryDetail />
        <QuoteViewer />
        <SettingsModal />
        <Notices />
      </div>
    </TooltipProvider>
  );
}
