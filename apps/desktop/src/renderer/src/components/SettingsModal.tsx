import { useEffect, useState } from 'react';
import type { SettingsInput } from '@shared/types';
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

  async function save() {
    setSaving(true);
    setError('');
    const input: SettingsInput = { ...form };
    if (input.SMTP_USER) input.IMAP_USER = input.SMTP_USER;
    if (input.SMTP_PASS) input.IMAP_PASS = input.SMTP_PASS;
    const res = await window.doldari.saveSettings(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? '저장 실패');
      return;
    }
    set({ config: res.config! });
    setForm((f) => ({ ...f, ANTHROPIC_API_KEY: '', SMTP_PASS: '' }));
    setSaved('저장했습니다.');
  }

  const input = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <form
        className="w-[500px] rounded-2xl border border bg-card shadow-2xl"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center border-b border px-5 py-3">
          <span className="font-semibold text-white">설정</span>
          <span className="ml-auto text-[11px] text-muted-foreground">이 컴퓨터에만 저장됩니다</span>
        </div>
        <div className="space-y-5 px-5 py-4 text-sm">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-foreground" htmlFor="api-key">Anthropic API 키</label>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.hasApiKey ? 'bg-emerald-500/15 text-emerald-300' : 'bg-destructive/15 text-destructive'}`}>
                {config.hasApiKey ? '저장됨' : '필요'}
              </span>
            </div>
            <input id="api-key" type="password" autoFocus spellCheck={false} placeholder={config.hasApiKey ? '새 키로 바꾸려면 입력 (비워 두면 유지)' : 'sk-ant-…'} value={form.ANTHROPIC_API_KEY ?? ''} onChange={up('ANTHROPIC_API_KEY')} className={`${input} font-mono`} />
            <select value={form.ANTHROPIC_MODEL ?? config.model} onChange={up('ANTHROPIC_MODEL')} className={input}>
              {[...new Set([config.model, ...MODELS])].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">저장할 때 키가 동작하는지 먼저 확인합니다. 키는 화면에 다시 표시되지 않습니다.</p>
            {config.hasApiKey && (
              <button type="button" onClick={async () => set({ config: await window.doldari.clearApiKey() })} className="text-[11px] text-destructive hover:underline">
                저장된 키 지우기
              </button>
            )}
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">브라우저</span>
              <span className="text-[11px] text-muted-foreground">지금: {config.browser === 'aside' ? 'Aside' : config.browser === 'electron' ? '내장 브라우저' : '확인 중'}</span>
            </div>
            <select value={form.BROWSER_BACKEND ?? config.browserPref} onChange={up('BROWSER_BACKEND')} className={input}>
              <option value="auto">Aside 우선 (설치되어 있으면 사용자의 Aside 브라우저)</option>
              <option value="electron">내장 브라우저 (앱 안에 보이는 브라우저)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">저장하면 바로 적용됩니다. 탐색 중이었다면 진행 중인 탐색은 멈춥니다.</p>
            <div className="flex gap-2">
              <input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} className={input} placeholder="https://www.naver.com" />
              <button type="button" onClick={() => window.doldari.openLoginWindow(loginUrl)} className="shrink-0 rounded-lg border px-3 text-xs font-semibold hover:bg-accent">
                브라우저 로그인
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">내장 브라우저에서 쓸 사이트에 직접 로그인해 두세요. 비밀번호는 돌다리가 보지 않고, 로그인 상태만 내장 브라우저와 공유됩니다.</p>
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">메일 (Gmail)</span>
              <span className="text-[11px] text-muted-foreground">{config.smtpConfigured ? '연결됨' : '선택 — 없으면 메일 앱으로 열기'}</span>
            </div>
            <input type="email" placeholder="Gmail 주소" value={form.SMTP_USER ?? ''} onChange={up('SMTP_USER')} className={input} />
            <input type="password" placeholder={config.smtpConfigured ? '앱 비밀번호 (비워 두면 유지)' : '앱 비밀번호 16자리'} value={form.SMTP_PASS ?? ''} onChange={up('SMTP_PASS')} className={`${input} font-mono`} />
            <p className="text-[11px] text-muted-foreground">Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호. 같은 계정으로 업체 회신도 자동으로 읽습니다.</p>
          </section>
          {error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
          {saved && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{saved}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border px-5 py-3">
          <button type="button" onClick={() => set({ settingsOpen: false })} className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">
            닫기
          </button>
          <button disabled={saving} className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
            {saving ? '확인 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}
