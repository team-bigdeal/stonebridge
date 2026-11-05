// IMAP 폴링(5초)으로 업체 회신을 회수한다. 제목 태그 [돌다리#B-xxxxxx]로 스레드를 매칭.
// Google 계정이 연결돼 있으면 그 계정으로(XOAUTH2), 아니면 앱 비밀번호로 접속한다.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MailKind, VendorId } from '@shared/types';
import { config, imapConfigured } from '../config';
import { notice } from '../events';
import { googleAccessToken, googleAccount } from './google-auth';

export interface IncomingReply {
  vendorId: VendorId;
  tag: string;
  messageId: string;
  from: string;
  subject: string;
  text: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

interface Watch {
  vendorId: VendorId;
  kind: MailKind;
  tag: string;
  resolve: (r: IncomingReply) => void;
}

const watches = new Map<string, Watch>();
let timer: NodeJS.Timeout | null = null;
let since = new Date();
const seen = new Set<string>();
let polling = false;
/** 확인 중에 checkNow가 불림 → 끝나면 한 번 더 확인 */
let again = false;

/** 지금 연결된 계정으로 IMAP 클라이언트를 만든다 (토큰이 바뀔 수 있어 접속할 때마다) */
async function imapClient() {
  const google = googleAccount();
  const { host, port, auth } = google
    ? { host: 'imap.gmail.com', port: 993, auth: { user: google, accessToken: await googleAccessToken() } }
    : { host: config.imap.host, port: config.imap.port, auth: { user: config.imap.user, pass: config.imap.pass } };
  const client = new ImapFlow({ host, port, secure: port === 993, auth, logger: false });
  // 접속 뒤 소켓 오류는 'error' 이벤트로 온다. 듣지 않으면 main 프로세스 전체가 죽는다 (진행 중인 명령은 따로 실패함)
  client.on('error', (e: Error) => console.log(`[imap] ${e.message}`));
  return client;
}

/** 내 메일함 주소 (내가 보낸 메일 사본을 회신으로 착각하지 않도록) */
const ownAddress = () => (googleAccount() ?? config.imap.user).toLowerCase();

/** 태그가 붙은 회신을 기다린다. 회신이 오면 콜백 */
export function watchReply(vendorId: VendorId, kind: MailKind, tag: string, onReply: (r: IncomingReply) => void) {
  // 기다리는 회신이 하나도 없을 때만 기준 날짜를 정한다 (기다리는 중에 앞당기면 그 사이 온 회신을 놓침).
  // IMAP SINCE는 날짜 단위라 시간대 차이에 걸리지 않도록 하루 앞에서부터 본다
  if (watches.size === 0) since = new Date(Date.now() - 24 * 3600_000);
  watches.set(tag, { vendorId, kind, tag, resolve: onReply });
  resumePolling();
}

export const isWatching = (tag: string) => watches.has(tag);

/** 기다리는 회신이 있고 메일 계정이 있으면 폴링을 (다시) 시작한다. 계정을 새로 연결했을 때도 부른다 */
export function resumePolling() {
  if (watches.size === 0 || !imapConfigured() || timer) return;
  timer = setInterval(() => void poll(), 5000);
  void poll();
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** 같은 실패를 5초마다 반복해 알리지 않는다 */
let lastError = '';

export function cancelWatch(tag: string) {
  watches.delete(tag);
}

/** 새 견적·조건 변경 때: 이전 검색의 회신은 더 기다리지 않는다 */
export function cancelAllWatches() {
  watches.clear();
  stopPolling();
}

/** 다음 폴링을 기다리지 않고 바로 확인 (멈춰 있었으면 다시 시작) */
export function checkNow() {
  resumePolling();
  // 확인 중이면 그 확인이 방금 들어온 메일을 놓쳤을 수 있어 끝나는 대로 한 번 더 본다
  if (polling) again = true;
  else void poll();
}

/** 받은편지함에 메일을 직접 넣는다 (시연용 업체 회신). 넣은 메일은 평소처럼 폴링으로 읽힌다 */
export async function appendToInbox(raw: Buffer) {
  const client = await imapClient();
  await client.connect();
  try {
    if (!(await client.append('INBOX', raw, []))) throw new Error('받은편지함에 넣지 못했어요');
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function poll() {
  if (polling || watches.size === 0) return;
  // 연결을 해제했거나 Google 연결이 만료됐으면 멈춘다 (다시 연결하면 resumePolling)
  if (!imapConfigured()) return stopPolling();
  polling = true;
  let client: ImapFlow | null = null;
  try {
    client = await imapClient();
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = ((await client.search({ since }, { uid: true })) || []).filter((uid) => !seen.has(String(uid)));
      // 제목만 먼저 보고, 기다리는 회신일 때만 본문을 받는다 (받은편지함 전체를 내려받지 않도록)
      const hits: { uid: number; subject: string; watch: Watch }[] = [];
      if (uids.length) {
        const me = ownAddress();
        for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? '';
          const from = (msg.envelope?.from?.[0]?.address ?? '').toLowerCase();
          const watch = [...watches.values()].find((w) => subject.includes(w.tag));
          // 우리가 보낸 메일 자체(보낸편지함 복사본·내 메일함으로 받은 시연 메일)는 건너뛴다
          if (watch && from !== me && /^(re|답장|회신)\s*:/i.test(subject.trim())) hits.push({ uid: msg.uid, subject, watch });
          // 기다리던 회신은 본문까지 받은 뒤에 읽음 처리한다 (받다가 실패하면 다음 폴링에서 다시)
          else seen.add(String(msg.uid));
        }
      }
      for (const { uid, subject, watch } of hits) {
        if (!watches.has(watch.tag)) continue;
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        seen.add(String(uid));
        // 받는 사이에 기다림을 거뒀으면(시연 회신을 바로 반영함) 두 번 처리하지 않는다
        if (!watches.has(watch.tag)) continue;
        watches.delete(watch.tag);
        watch.resolve({
          vendorId: watch.vendorId,
          tag: watch.tag,
          messageId: parsed.messageId ?? String(uid),
          from: parsed.from?.text ?? '',
          subject,
          text: stripQuoted(parsed.text ?? ''),
          attachments: parsed.attachments.map((a) => ({ filename: a.filename ?? 'attachment', contentType: a.contentType, content: a.content }))
        });
      }
    } finally {
      lock.release();
    }
    await client.logout();
    lastError = '';
  } catch (e) {
    const msg = `메일 회신 확인 실패: ${e instanceof Error ? e.message : e}`;
    if (msg !== lastError) notice(msg);
    lastError = msg;
    await client?.logout().catch(() => undefined);
  } finally {
    polling = false;
    if (watches.size === 0) stopPolling();
    else if (again) {
      again = false;
      void poll();
    }
  }
}

/** 인용된 원문("... 작성:" 이후, ">" 줄) 제거 */
function stripQuoted(text: string) {
  const lines = text.split('\n');
  const cut = lines.findIndex((l) => /^(On .+wrote:|20\d\d.+작성:|-----Original Message-----)/.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith('>')).join('\n').trim();
}
