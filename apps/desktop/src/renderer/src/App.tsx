import { useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useStore } from './store';
import { Chat } from './components/Chat';
import { ExpandedBrowser, Notices, SidebarToggle, TopBar } from './components/Shell';
import { pushCursor, pushFrame } from './components/workspace/LiveFrame';
import { QuoteViewer } from './components/QuoteViewer';
import SettingsModal from './components/SettingsModal';
import { HistorySidebar } from './components/HistorySidebar';
import { startAutosave } from './replay';

export default function App() {
  const handle = useStore((s) => s.handle);
  const set = useStore((s) => s.set);
  const sidebarOpen = useStore((s) => s.sidebarOpen);

  useEffect(() => {
    window.doldari.config().then((c) => set({ config: c, settingsOpen: !c.hasApiKey, backend: c.browser }));
    const offEvent = window.doldari.onEvent(handle);
    const offFrame = window.doldari.onFrame(({ slot, data }) => pushFrame(slot, data));
    const offCursor = window.doldari.onCursor(pushCursor);
    const offSave = startAutosave();
    return () => {
      offEvent();
      offFrame();
      offCursor();
      offSave();
    };
  }, [handle, set]);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <HistorySidebar />
          <main className="relative min-w-0 flex-1">
            {/* 사이드바가 닫혀 있으면 그 자리(왼쪽 위)에서 다시 연다 */}
            {!sidebarOpen && <SidebarToggle className="absolute left-2 top-2 z-10 bg-white/80 shadow-sm" />}
            <Chat />
          </main>
        </div>
        <ExpandedBrowser />
        <QuoteViewer />
        <SettingsModal />
        <Notices />
      </div>
    </TooltipProvider>
  );
}
