// IMAP 폴링(5초)으로 업체 회신을 회수한다. 제목 태그 [돌다리#B-xxxxxx]로 스레드를 매칭.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MailKind, VendorId } from '@shared/types';
import { config, imapConfigured } from '../config';
import { notice } from '../events';

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

/** 태그가 붙은 회신을 기다린다. 회신이 오면 콜백 */
export function watchReply(vendorId: VendorId, kind: MailKind, tag: string, onReply: (r: IncomingReply) => void) {
  watches.set(tag, { vendorId, kind, tag, resolve: onReply });
  if (imapConfigured() && !timer) {
    since = new Date(Date.now() - 60_000);
    timer = setInterval(() => void poll(), 5000);
    void poll();
  }
}

export function cancelWatch(tag: string) {
  watches.delete(tag);
}

async function poll() {
  if (polling || watches.size === 0) return;
  polling = true;
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.port === 993,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since }, { uid: true });
      for (const uid of uids || []) {
        const key = String(uid);
        if (seen.has(key)) continue;
        const msg = await client.fetchOne(key, { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        seen.add(key);
        const subject = msg.envelope?.subject ?? '';
        const watch = [...watches.values()].find((w) => subject.includes(w.tag));
        // 우리가 보낸 메일 자체(보낸편지함 복사본)는 건너뛴다
        if (!watch || !/^(re|답장|회신)\s*:/i.test(subject.trim())) continue;
        const parsed = await simpleParser(msg.source);
        watches.delete(watch.tag);
        watch.resolve({
          vendorId: watch.vendorId,
          tag: watch.tag,
          messageId: parsed.messageId ?? key,
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
  } catch (e) {
    notice(`메일 회신 확인 실패: ${e instanceof Error ? e.message : e}`);
  } finally {
    polling = false;
    if (watches.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
}

/** 인용된 원문("... 작성:" 이후, ">" 줄) 제거 */
function stripQuoted(text: string) {
  const lines = text.split('\n');
  const cut = lines.findIndex((l) => /^(On .+wrote:|20\d\d.+작성:|-----Original Message-----)/.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith('>')).join('\n').trim();
}
