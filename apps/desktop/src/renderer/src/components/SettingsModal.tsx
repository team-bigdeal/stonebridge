import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { AppConfig, SettingsInput, ThemeMode } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet' },
  { id: 'claude-haiku-5-5', label: 'Haiku' }
];

/** 설정 창 (메인 화면 카드와 같은 모양). 모든 항목을 한 화면에서 본다.
 *  비밀값은 main 프로세스로만 가고 화면에 다시 표시하지 않는다 */
export default function SettingsModal() {
  const { settingsOpen, settingsTab, config, set } = useStore();
  const mailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!settingsOpen || !config) return;
    // 메일 카드의 "Google 계정을 연결하면…"으로 열었으면 메일 항목으로 바로 내려 준다
    if (settingsTab === 'mail') requestAnimationFrame(() => mailRef.current?.scrollIntoView({ block: 'start' }));
    // 열 때마다 최신 상태로 (Google 연결이 만료됐을 수 있음)
    void window.doldari.config().then((c) => set({ config: c }));
    // 열 때 한 번만 (config가 바뀔 때마다 하면 입력 중인 값이 지워짐)
  }, [settingsOpen]);

  if (!settingsOpen || !config) return null;
  const close = () => set({ settingsOpen: false, settingsTab: undefined });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div role="dialog" aria-modal="true" aria-label="설정" className="flex max-h-[88vh] w-full max-w-[720px] flex-col gap-4 rounded-lg bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-2 pb-3">
          <div className="flex flex-col gap-2 leading-normal">
            <p className="text-[19px] font-semibold text-ink">설정</p>
            <p className="text-[14px] font-medium text-muted-foreground">이 컴퓨터에만 저장돼요.</p>
          </div>
          <button type="button" onClick={close} aria-label="닫기" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-ink">
            <X className="size-5" />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-1">
          <div className="flex flex-col gap-8">
            <Section title="화면">
              <ThemeTab config={config} />
            </Section>
            <Section title="AI 모델">
              <AiTab config={config} />
            </Section>
            <Section title="브라우저">
              <BrowserTab config={config} />
            </Section>
            <Section title="메일" ref={mailRef}>
              <MailTab config={config} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, ref }: { title: string; children: React.ReactNode; ref?: React.Ref<HTMLElement> }) {
  return (
    <section ref={ref} className="flex scroll-mt-2 flex-col gap-4">
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** 바뀐 값만 저장하고 결과를 그 자리에서 보여 준다 */
function useSave() {
  const set = useStore((s) => s.set);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  async function save(input: SettingsInput, after?: () => void) {
    setState('saving');
    setError('');
    const res = await window.doldari.saveSettings(input).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e), config: undefined }));
    if (!res.ok) {
      setState('idle');
      setError(res.error ?? '저장하지 못했어요');
      return;
    }
    if (res.config) set({ config: res.config });
    setState('saved');
    after?.();
    setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000);
  }
  return { state, error, save };
}

/** 선택하면 바로 저장하고 바로 반영한다 (재시작 필요 없음) */
function ThemeTab({ config }: { config: AppConfig }) {
  const set = useStore((s) => s.set);
  const { error, save } = useSave();
  const pick = (v: string) => {
    // 저장 응답을 기다리지 않고 먼저 화면에 반영
    set({ config: { ...config, theme: v as ThemeMode } });
    void save({ THEME: v });
  };
  return (
    <div className="flex flex-col gap-5">
      <Row label="화면 테마" hint={error || '시스템은 컴퓨터의 라이트·다크 설정을 따라가요. 견적서와 업체 사이트 화면은 항상 원래 색으로 보여요.'}>
        <Segmented
          value={config.theme}
          options={[
            { value: 'system', label: '시스템' },
            { value: 'light', label: '라이트' },
            { value: 'dark', label: '다크' }
          ]}
          onChange={pick}
        />
      </Row>
    </div>
  );
}

function AiTab({ config }: { config: AppConfig }) {
  const set = useStore((s) => s.set);
  const [key, setKey] = useState('');
  const [editKey, setEditKey] = useState(!config.hasApiKey);
  const [model, setModel] = useState(config.model);
  const { state, error, save } = useSave();
  const models = MODELS.some((m) => m.id === config.model) ? MODELS : [{ id: config.model, label: config.model }, ...MODELS];
  const dirty = model !== config.model || key.trim() !== '';

  return (
    <div className="flex flex-col gap-5">
      <Row label="API 키" hint={editKey ? `저장할 때 키가 동작하는지 먼저 확인해요.${config.hasApiKey ? ' 비워 두면 지금 키를 그대로 써요.' : ''}` : '저장한 키는 다시 보여 주지 않아요.'}>
        {editKey ? (
          <Box filled={key !== ''}>
            <BareInput type="password" autoFocus spellCheck={false} placeholder="sk-ant-…" value={key} onChange={setKey} className="font-mono" />
          </Box>
        ) : (
          <div className="flex items-center gap-3">
            <Box filled>
              <span className="text-[14px] font-medium text-ink">저장됨</span>
            </Box>
            <Button type="button" variant="outline" className="h-auto px-4 py-2.5 text-[14px]" onClick={() => setEditKey(true)}>
              바꾸기
            </Button>
            <button type="button" onClick={async () => set({ config: await window.doldari.clearApiKey() })} className="text-[13px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline">
              지우기
            </button>
          </div>
        )}
      </Row>

      <Row label="모델" hint="Opus는 가장 꼼꼼하고, Haiku는 가장 빨라요.">
        <Segmented value={model} options={models.map((m) => ({ value: m.id, label: m.label }))} onChange={setModel} />
      </Row>

      <SaveBar
        dirty={dirty}
        state={state}
        error={error}
        label={key.trim() ? '키 확인하고 저장' : '저장'}
        onSave={() =>
          save({ ...(key.trim() ? { ANTHROPIC_API_KEY: key.trim() } : {}), ANTHROPIC_MODEL: model }, () => {
            setKey('');
            setEditKey(false);
          })
        }
      />
    </div>
  );
}

function BrowserTab({ config }: { config: AppConfig }) {
  const [pref, setPref] = useState(config.browserPref);
  const [loginUrl, setLoginUrl] = useState('https://www.naver.com');
  const { state, error, save } = useSave();
  const dirty = pref !== config.browserPref;
  const now = config.browser === 'aside' ? 'Aside 브라우저' : config.browser === 'electron' ? '내장 브라우저' : '확인 중';

  return (
    <div className="flex flex-col gap-5">
      <Row
        label="쓸 브라우저"
        hint={dirty ? '저장하면 바로 바뀌어요. 탐색 중이었다면 진행 중인 탐색은 멈춰요.' : `지금은 ${now}로 탐색해요. Aside 우선은 Aside가 설치돼 있으면 내 Aside 탭을 써요.`}
      >
        <Segmented
          value={pref}
          options={[
            { value: 'auto', label: 'Aside 우선' },
            { value: 'electron', label: '내장 브라우저' }
          ]}
          onChange={(v) => setPref(v as AppConfig['browserPref'])}
        />
      </Row>
      <SaveBar dirty={dirty} state={state} error={error} onSave={() => save({ BROWSER_BACKEND: pref })} />

      <Row label="미리 로그인" hint="내장 브라우저에서 쓸 사이트에 직접 로그인해 두세요. 돌다리는 비밀번호를 보지 않아요.">
        <div className="flex items-center gap-3">
          <Box filled={loginUrl !== ''} className="flex-1">
            <BareInput value={loginUrl} onChange={setLoginUrl} placeholder="https://www.naver.com" />
          </Box>
          <Button type="button" variant="outline" className="h-auto shrink-0 px-4 py-2.5 text-[14px]" onClick={() => window.doldari.openLoginWindow(loginUrl)}>
            로그인 창 열기
          </Button>
        </div>
      </Row>
    </div>
  );
}

function MailTab({ config }: { config: AppConfig }) {
  const set = useStore((s) => s.set);
  const [google, setGoogle] = useState<'idle' | 'waiting'>('idle');
  const [googleError, setGoogleError] = useState('');
  const [advanced, setAdvanced] = useState(!config.googleClient || config.mailAuth === 'password');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [smtpUser, setSmtpUser] = useState(config.smtpUser);
  const [smtpPass, setSmtpPass] = useState('');
  const client = useSave();
  const password = useSave();

  /** 시스템 브라우저에서 로그인·동의를 마칠 때까지 기다린다 */
  async function connectGoogle() {
    setGoogleError('');
    setGoogle('waiting');
    try {
      const res = await window.doldari.connectGoogle();
      set({ config: res.config });
      if (!res.ok) setGoogleError(res.error ?? 'Google 계정을 연결하지 못했어요.');
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Google 계정을 연결하지 못했어요.');
    } finally {
      setGoogle('idle');
    }
  }

  async function disconnectGoogle() {
    setGoogleError('');
    try {
      set({ config: await window.doldari.disconnectGoogle() });
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : '연결을 해제하지 못했어요.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Row
        label="Google 계정"
        hint={
          google === 'waiting'
            ? '브라우저에서 Google 로그인과 메일 권한 허용을 마쳐 주세요.'
            : "연결하면 메일 카드에서 '승인하고 보내기'를 누를 때 이 계정으로 업체에 보내고, 회신도 자동으로 읽어요. 7일마다 다시 연결해야 해요."
        }
      >
        <div className="flex items-center gap-3">
          {config.googleUser ? (
            <>
              <Box filled className="min-w-0 flex-1">
                <span className="truncate text-[14px] font-medium text-ink" title={config.googleUser}>
                  {config.googleUser}
                </span>
              </Box>
              <Button type="button" variant="outline" className="h-auto shrink-0 px-4 py-2.5 text-[14px]" onClick={() => void disconnectGoogle()}>
                연결 해제
              </Button>
            </>
          ) : google === 'waiting' ? (
            <>
              <Box className="flex-1">
                <span className="text-[14px] font-medium text-muted-foreground">로그인 기다리는 중…</span>
              </Box>
              <Button type="button" variant="outline" className="h-auto shrink-0 px-4 py-2.5 text-[14px]" onClick={() => void window.doldari.cancelGoogle()}>
                취소
              </Button>
            </>
          ) : (
            <>
              <Box className="flex-1">
                <span className="text-[14px] font-medium text-muted-foreground">연결 안 됨</span>
              </Box>
              <Button type="button" variant="secondary" className="h-auto shrink-0 px-4 py-2.5 text-[14px]" disabled={!config.googleClient} onClick={() => void connectGoogle()}>
                Google 계정으로 연결
              </Button>
            </>
          )}
        </div>
        {googleError && <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{googleError}</p>}
        {!config.googleClient && !config.googleUser && <p className="text-[13px] text-muted-foreground">먼저 아래 고급 설정에 OAuth 클라이언트를 저장해 주세요.</p>}
      </Row>

      <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex w-fit items-center gap-1 text-[14px] font-medium text-muted-foreground hover:text-ink">
        고급 설정
        <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
      </button>

      {advanced && (
        <>
          <Row label="OAuth 클라이언트" hint={`Google Cloud 콘솔의 '데스크톱 앱' 클라이언트 값이에요. 팀 공용 값은 팀 비밀번호 관리자에서 받으세요.${config.googleClient ? ' 지금 값이 저장돼 있어요.' : ''}`}>
            <div className="grid grid-cols-2 gap-3">
              <Box filled={clientId !== ''}>
                <BareInput placeholder={config.googleClient ? '새 클라이언트 ID' : '클라이언트 ID'} spellCheck={false} value={clientId} onChange={setClientId} />
              </Box>
              <Box filled={clientSecret !== ''}>
                <BareInput type="password" placeholder={config.googleClient ? '새 보안 비밀' : '보안 비밀'} value={clientSecret} onChange={setClientSecret} className="font-mono" />
              </Box>
            </div>
          </Row>
          <SaveBar
            dirty={Boolean(clientId.trim() || clientSecret.trim())}
            state={client.state}
            error={client.error}
            onSave={() =>
              client.save({ ...(clientId.trim() ? { GOOGLE_CLIENT_ID: clientId.trim() } : {}), ...(clientSecret.trim() ? { GOOGLE_CLIENT_SECRET: clientSecret.trim() } : {}) }, () => {
                setClientId('');
                setClientSecret('');
              })
            }
          />

          <Row label="앱 비밀번호" hint="다른 방법이에요. Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 만들 수 있어요. Google 계정이 연결돼 있으면 그쪽을 먼저 써요.">
            <div className="grid grid-cols-2 gap-3">
              <Box filled={smtpUser !== ''}>
                <BareInput type="email" placeholder="Gmail 주소" value={smtpUser} onChange={setSmtpUser} />
              </Box>
              <Box filled={smtpPass !== ''}>
                <BareInput type="password" placeholder={config.mailAuth === 'password' ? '새 앱 비밀번호' : '앱 비밀번호 16자리'} value={smtpPass} onChange={setSmtpPass} className="font-mono" />
              </Box>
            </div>
          </Row>
          <SaveBar
            dirty={smtpUser.trim() !== config.smtpUser || smtpPass.trim() !== ''}
            state={password.state}
            error={password.error}
            onSave={() =>
              password.save(
                {
                  ...(smtpUser.trim() ? { SMTP_USER: smtpUser.trim(), IMAP_USER: smtpUser.trim() } : {}),
                  ...(smtpPass.trim() ? { SMTP_PASS: smtpPass.trim(), IMAP_PASS: smtpPass.trim() } : {})
                },
                () => setSmtpPass('')
              )
            }
          />
        </>
      )}
    </div>
  );
}

// ─── 메인 화면 카드와 같은 조각 ───────────────────────────────

/** 왼쪽 항목 이름 + 오른쪽 내용, 아래 줄 (메일 카드의 받는 사람·제목 줄과 같은 모양) */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-5 border-b border-line pb-5">
      <span className="w-[120px] shrink-0 whitespace-nowrap pt-2.5 text-[14px] font-medium text-ink">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {children}
        {hint && <p className="text-[13px] leading-[1.6] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** 요구 조건 카드의 칸: 값이 있으면 연한 파랑, 비었으면 회색 */
function Box({ filled = false, className, children }: { filled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('flex min-w-0 items-center rounded-lg px-4 py-2.5 transition-shadow focus-within:ring-2 focus-within:ring-primary/30', filled ? 'bg-tint' : 'bg-muted', className)}>
      {children}
    </label>
  );
}

function BareInput({
  value,
  onChange,
  className,
  ...rest
}: { value: string; onChange: (v: string) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <Input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-auto w-full rounded-none border-0 bg-transparent p-0 text-[14px] font-medium text-ink shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[14px]', className)}
    />
  );
}

/** "나란히 / 크게 보기"와 같은 회색 토글 */
function Segmented({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex w-fit items-center rounded-lg bg-muted p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-4 py-2 text-[14px] font-medium transition-colors', value === o.value ? 'bg-card text-ink dark:bg-input shadow-sm' : 'text-muted-foreground hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 바뀐 게 있을 때만 보이는 저장 버튼 (메일 카드의 연파랑 버튼) */
function SaveBar({ dirty, state, error, label = '저장', onSave }: { dirty: boolean; state: 'idle' | 'saving' | 'saved'; error: string; label?: string; onSave: () => void }) {
  if (!dirty && state !== 'saved' && !error) return null;
  return (
    <div className="flex items-center justify-end gap-3">
      {error && <span className="min-w-0 flex-1 rounded-lg bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">{error}</span>}
      {state === 'saved' && !error && (
        <span className="flex items-center gap-1 text-[14px] font-medium text-ok">
          <Check className="size-4" /> 저장했어요
        </span>
      )}
      {dirty && (
        <Button type="button" variant="secondary" className="h-auto px-4 py-2.5 text-[14px]" disabled={state === 'saving'} onClick={onSave}>
          {state === 'saving' ? '확인 중…' : label}
        </Button>
      )}
    </div>
  );
}
