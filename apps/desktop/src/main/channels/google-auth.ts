// Google 계정 연결 (OAuth 2.0, 데스크톱 앱 방식: 시스템 브라우저 + 127.0.0.1 임시 주소 + PKCE)
// 연결하면 그 계정으로 SMTP 발송·IMAP 회신 확인을 한다 (XOAUTH2). 돌다리는 Google 비밀번호를 보지 않는다.
// 갱신 토큰은 OS 키체인으로 암호화해 사용자 데이터 폴더에만 두고, renderer에는 넘기지 않는다.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { app, safeStorage, shell } from 'electron';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/** Gmail SMTP·IMAP(XOAUTH2) 로그인에는 이 권한이 있어야 한다 (gmail.send만으로는 SMTP 로그인이 안 됨) */
export const MAIL_SCOPE = 'https://mail.google.com/';
const SCOPES = ['openid', 'email', MAIL_SCOPE];
/** 브라우저에서 로그인을 마칠 때까지 기다리는 시간 */
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface Account {
  email: string;
  refreshToken: string;
}
interface Stored {
  email: string;
  /** encrypted면 safeStorage로 암호화한 값(base64) */
  refreshToken: string;
  encrypted: boolean;
  connectedAt: string;
}
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}
type CodedError = Error & { code?: string };

let loaded = false;
let account: Account | null = null;
let access: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string> | null = null;
let pending: { cancel: (why: string) => void } | null = null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const b64url = (buf: Buffer) => buf.toString('base64url');
const accountFile = () => path.join(app.getPath('userData'), 'google-account.json');

/** 클라이언트 ID·보안 비밀은 .env에서 읽는다 (설정 창에서 저장하면 config.ts가 process.env도 바로 바꿈) */
function client() {
  return { id: process.env.GOOGLE_CLIENT_ID?.trim() || '', secret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '' };
}

export const googleClientConfigured = () => Boolean(client().id);

/** 저장된 계정을 처음 쓸 때 읽는다 (safeStorage는 앱 준비 뒤에만 쓸 수 있음) */
function ensureLoaded() {
  if (loaded || !app.isReady()) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(accountFile(), 'utf8')) as Stored;
    const refreshToken = raw.encrypted ? safeStorage.decryptString(Buffer.from(raw.refreshToken, 'base64')) : raw.refreshToken;
    if (raw.email && refreshToken) account = { email: raw.email, refreshToken };
  } catch {
    // 파일이 없거나 읽을 수 없으면 연결 안 된 상태
  }
}

function persist(next: Account | null) {
  account = next;
  access = null;
  refreshing = null;
  if (!next) {
    fs.rmSync(accountFile(), { force: true });
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  const data: Stored = {
    email: next.email,
    refreshToken: encrypted ? safeStorage.encryptString(next.refreshToken).toString('base64') : next.refreshToken,
    encrypted,
    connectedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(accountFile()), { recursive: true });
  fs.writeFileSync(accountFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.chmodSync(accountFile(), 0o600);
}

/** 연결된 Google 계정 주소 (없으면 null) */
export function googleAccount(): string | null {
  ensureLoaded();
  return account?.email ?? null;
}

/** 브라우저에서 Google 로그인 → 메일 권한 동의 → 계정 저장. 연결한 주소를 돌려준다 */
export async function connectGoogle(): Promise<string> {
  const { id, secret } = client();
  if (!id) throw new Error('Google OAuth 클라이언트 ID가 없어요. 설정 창에서 클라이언트 ID와 보안 비밀을 먼저 저장해 주세요.');
  pending?.cancel('새로 연결을 시작해서 이전 시도는 그만뒀어요.');
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  const { code, redirectUri } = await waitForCode(id, challenge, state);
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: id,
    ...(secret ? { client_secret: secret } : {})
  });
  // 동의 화면에서 메일 권한 체크를 풀 수 있다 → 그러면 보내기·회신 확인을 못 하므로 연결하지 않는다
  if (!(tokens.scope ?? '').split(' ').includes(MAIL_SCOPE)) {
    throw new Error('Gmail 권한을 허용하지 않아서 연결하지 못했어요. 다시 연결하면서 메일 권한에 체크해 주세요.');
  }
  if (!tokens.refresh_token) throw new Error('Google에서 갱신 토큰을 받지 못했어요. 다시 연결해 주세요.');
  const email = emailFromIdToken(tokens.id_token);
  if (!email) throw new Error('Google 계정 메일 주소를 확인하지 못했어요. 다시 연결해 주세요.');
  ensureLoaded();
  persist({ email, refreshToken: tokens.refresh_token });
  access = { token: tokens.access_token!, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
  return email;
}

/** 브라우저 로그인을 기다리는 중이면 그만둔다 */
export function cancelGoogleLogin() {
  pending?.cancel('Google 연결을 취소했어요.');
}

/** 연결 해제: 저장한 토큰을 지우고 Google에도 권한 철회를 요청한다 */
export async function disconnectGoogle() {
  ensureLoaded();
  const token = account?.refreshToken;
  persist(null);
  if (token) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => undefined);
  }
}

/** SMTP·IMAP 로그인에 쓸 액세스 토큰. 만료 1분 전부터는 갱신 토큰으로 새로 받는다 */
export async function googleAccessToken(): Promise<string> {
  ensureLoaded();
  const acc = account;
  if (!acc) throw new Error('Google 계정이 연결되어 있지 않아요. 설정에서 연결해 주세요.');
  if (access && access.expiresAt - Date.now() > 60_000) return access.token;
  refreshing ??= (async () => {
    const { id, secret } = client();
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refreshToken, client_id: id, ...(secret ? { client_secret: secret } : {}) });
      // 갱신하는 사이 다른 계정으로 다시 연결했으면 그 계정의 토큰을 덮지 않는다
      if (account === acc) access = { token: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
      return t.access_token!;
    } catch (e) {
      // 사용자가 권한을 철회했거나 토큰이 만료됨 (테스트 모드 OAuth 앱은 7일마다 만료) → 다시 연결해야 한다
      if ((e as CodedError).code === 'invalid_grant') {
        if (account === acc) persist(null);
        throw new Error('Google 연결이 만료됐어요. 설정에서 Google 계정을 다시 연결해 주세요.');
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** 127.0.0.1 임시 서버를 열고 브라우저로 동의 화면을 띄운 뒤, Google이 돌려보내는 code를 받는다 */
function waitForCode(clientId: string, challenge: string, state: string): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      // 다른 요청(미리 불러오기 등)이나 state가 다른 요청은 무시하고 계속 기다린다
      if (url.searchParams.get('state') !== state || (!code && !error)) {
        page(res, 400, '잘못된 요청이에요', '돌다리 앱에서 다시 연결해 주세요.');
        return;
      }
      if (error) {
        page(res, 200, 'Google 연결을 취소했어요', '이 창을 닫고 돌다리 앱으로 돌아가 주세요.');
        finish(new Error(error === 'access_denied' ? 'Google 연결을 취소했어요.' : `Google 로그인 오류: ${error}`));
        return;
      }
      // 토큰 교환·권한 확인은 이 뒤에 하므로 결과는 앱에서 보여 준다
      page(res, 200, 'Google 로그인을 마쳤어요', '이 창을 닫고 돌다리 앱으로 돌아가 연결 결과를 확인해 주세요.');
      finish(null, code!);
    });
    function finish(err: Error | null, code?: string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending = null;
      server.close();
      if (err) reject(err);
      else resolve({ code: code!, redirectUri });
    }
    server.on('error', (e) => finish(new Error(`로그인 응답을 받을 준비를 하지 못했어요: ${errMsg(e)}`)));
    timer = setTimeout(() => finish(new Error('Google 로그인을 기다리다 시간이 지났어요. 다시 연결해 주세요.')), LOGIN_TIMEOUT_MS);
    pending = { cancel: (why) => finish(new Error(why)) };
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}`;
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // 갱신 토큰을 받아야 다음 실행에도 로그인 없이 보낼 수 있다
        access_type: 'offline',
        prompt: 'consent'
      });
      shell.openExternal(`${AUTH_URL}?${q}`).catch((e) => finish(new Error(`브라우저를 열지 못했어요: ${errMsg(e)}`)));
    });
  });
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (e) {
    throw new Error(`Google에 연결하지 못했어요: ${errMsg(e)}`);
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    const err: CodedError = new Error(`Google 토큰 오류: ${data.error_description || data.error || `HTTP ${res.status}`}`);
    err.code = data.error;
    throw err;
  }
  return data;
}

/** 토큰 엔드포인트에서 TLS로 바로 받은 ID 토큰이라 서명 검증 없이 이메일만 꺼낸다 (OIDC Core 3.1.3.7) */
function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1], 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/** 로그인을 마친 브라우저 탭에 보여 줄 안내 (사용자 입력을 그대로 넣지 않는다) */
function page(res: http.ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>돌다리</title></head>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f9;color:#121826;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif">` +
      `<div style="text-align:center"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#4a5366">${body}</p></div></body></html>`
  );
}
