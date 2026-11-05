import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { SettingsInput } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Pill } from './cards/Section';
import { useStore } from '../store';

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

/** API 키·메일 설정. 비밀값은 main 프로세스로만 가고 화면에 다시 표시하지 않는다 */
export default function SettingsModal() {
  const { settingsOpen, config, set } = useStore();
  const [form, setForm] = useState<SettingsInput>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [loginUrl, setLoginUrl] = useState('https://www.naver.com');

  useEffect(() => {
    if (!settingsOpen || !config) return;
    setForm({ ANTHROPIC_MODEL: config.model, SMTP_USER: config.smtpUser, BROWSER_BACKEND: config.browserPref });
    setError('');
    setSaved('');
  }, [settingsOpen, config]);

  if (!settingsOpen || !config) return null;
  const up = (k: keyof SettingsInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const close = () => set({ settingsOpen: false });

  async function save() {
    setSaving(true);
    setError('');
    const input: SettingsInput = { ...form };
    if (input.SMTP_USER) input.IMAP_USER = input.SMTP_USER;
    if (input.SMTP_PASS) input.IMAP_PASS = input.SMTP_PASS;
    const res = await window.doldari.saveSettings(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? '저장하지 못했어요');
      return;
    }
    set({ config: res.config! });
    setForm((f) => ({ ...f, ANTHROPIC_API_KEY: '', SMTP_PASS: '' }));
    setSaved('저장했어요.');
  }

  const select = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form
        className="flex max-h-[90vh] w-[520px] flex-col rounded-xl border bg-card shadow-2xl"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <div>
            <div className="text-[15px] font-semibold">설정</div>
            <div className="text-[12px] text-muted-foreground">이 컴퓨터에만 저장돼요</div>
          </div>
          <Button type="button" size="icon" variant="ghost" className="ml-auto size-8" onClick={close} aria-label="닫기">
            <X className="size-4" />
          </Button>
        </div>

        {/* 지금 상태 한눈에 (상단 바에서 옮겨 옴) */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b bg-muted/30 px-5 py-2.5 text-[12px] text-muted-foreground">
          <Status on={config.hasApiKey} bad={!config.hasApiKey}>{config.hasApiKey ? config.model : 'API 키 필요'}</Status>
          <Status on={config.browser === 'aside'} warn={config.browser === 'electron'} title={config.browser === 'aside' ? '사용자의 Aside 브라우저로 탐색해요' : '앱 안에 보이는 브라우저로 탐색해요'}>
            {config.browser === 'aside' ? 'Aside 브라우저' : config.browser === 'electron' ? '내장 브라우저' : '브라우저 확인 중'}
          </Status>
          <Status on={config.smtpConfigured}>{config.smtpConfigured ? '메일 연결됨' : '메일 연결 안 됨'}</Status>
        </div>

        <div className="scroll-thin min-h-0 flex-1 divide-y overflow-y-auto px-5 text-sm">
          <Section title="Anthropic API 키" status={<Pill tone={config.hasApiKey ? 'ok' : 'bad'}>{config.hasApiKey ? '저장됨' : '필요'}</Pill>}>
            <Input
              id="api-key"
              type="password"
              autoFocus
              spellCheck={false}
              placeholder={config.hasApiKey ? '바꾸려면 새 키를 입력 (비워 두면 그대로)' : 'sk-ant-…'}
              value={form.ANTHROPIC_API_KEY ?? ''}
              onChange={up('ANTHROPIC_API_KEY')}
              className="font-mono"
            />
            <label className="block space-y-1">
              <span className="text-[12px] text-muted-foreground">모델</span>
              <select value={form.ANTHROPIC_MODEL ?? config.model} onChange={up('ANTHROPIC_MODEL')} className={select}>
                {[...new Set([config.model, ...MODELS])].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <Hint>
              저장할 때 키가 동작하는지 먼저 확인해요. 저장한 키는 다시 보여 주지 않아요.
              {config.hasApiKey && (
                <button type="button" onClick={async () => set({ config: await window.doldari.clearApiKey() })} className="ml-2 text-destructive hover:underline">
                  저장된 키 지우기
                </button>
              )}
            </Hint>
          </Section>

          <Section
            title="브라우저"
            status={<span className="text-[12px] text-muted-foreground">지금 {config.browser === 'aside' ? 'Aside' : config.browser === 'electron' ? '내장 브라우저' : '확인 중'}</span>}
          >
            <select value={form.BROWSER_BACKEND ?? config.browserPref} onChange={up('BROWSER_BACKEND')} className={select}>
              <option value="auto">Aside 우선 (설치돼 있으면 내 Aside 브라우저 사용)</option>
              <option value="electron">내장 브라우저 (앱 안에서 보이는 브라우저)</option>
            </select>
            <Hint>저장하면 바로 바뀌어요. 탐색 중이었다면 진행 중인 탐색은 멈춰요.</Hint>
            <div className="space-y-1 pt-1">
              <span className="text-[12px] text-muted-foreground">미리 로그인해 둘 사이트</span>
              <div className="flex gap-2">
                <Input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://www.naver.com" />
                <Button type="button" variant="outline" className="shrink-0" onClick={() => window.doldari.openLoginWindow(loginUrl)}>
                  로그인 창 열기
                </Button>
              </div>
            </div>
            <Hint>내장 브라우저에서 쓸 사이트에 직접 로그인해 두세요. 돌다리는 비밀번호를 보지 않고 로그인 상태만 함께 써요.</Hint>
          </Section>

          <Section title="메일 (Gmail)" status={config.smtpConfigured ? <Pill tone="ok">연결됨</Pill> : <span className="text-[12px] text-muted-foreground">선택 사항</span>}>
            <Input type="email" placeholder="Gmail 주소" value={form.SMTP_USER ?? ''} onChange={up('SMTP_USER')} />
            <Input
              type="password"
              placeholder={config.smtpConfigured ? '앱 비밀번호 (비워 두면 그대로)' : '앱 비밀번호 16자리'}
              value={form.SMTP_PASS ?? ''}
              onChange={up('SMTP_PASS')}
              className="font-mono"
            />
            <Hint>Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 만들 수 있어요. 연결하면 업체 회신도 자동으로 읽어요. 없으면 메일 앱으로 열어서 보내면 돼요.</Hint>
          </Section>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {error && <span className="min-w-0 truncate text-[12px] text-destructive" title={error}>{error}</span>}
          {!error && saved && <span className="text-[12px] text-ok">{saved}</span>}
          <Button type="button" variant="ghost" className="ml-auto" onClick={close}>
            닫기
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? '확인 중…' : '저장'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Section({ title, status, children }: { title: string; status?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        {status}
      </div>
      {children}
    </section>
  );
}

const Hint = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn('text-[12px] leading-relaxed text-muted-foreground', className)}>{children}</p>
);

function Status({ on, warn, bad, title, children }: { on: boolean; warn?: boolean; bad?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className={cn('size-1.5 rounded-full', bad ? 'bg-destructive' : on ? 'bg-ok' : warn ? 'bg-warn' : 'bg-muted-foreground/50')} />
      {children}
    </span>
  );
}
