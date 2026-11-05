// 메일 발송 (nodemailer). 사용자가 "보내기"를 눌렀을 때만 호출된다.
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailDraft, MailRecord } from '@shared/types';
import { config, smtpConfigured } from '../config';
import { emit } from '../events';

let transporter: Transporter | null = null;

export const mailbox: MailRecord[] = [];

export function recordMail(m: MailRecord) {
  mailbox.push(m);
  emit('mail', { vendorId: m.vendorId, payload: m });
}

/** 회신을 같은 스레드로 찾기 위한 제목 태그 */
export const subjectTag = (draft: Pick<MailDraft, 'vendorId' | 'id'>) => `[돌다리#${draft.vendorId}-${draft.id.slice(0, 6)}]`;

export async function sendMail(draft: MailDraft): Promise<MailRecord> {
  const tag = subjectTag(draft);
  const subject = draft.subject.includes(tag) ? draft.subject : `${draft.subject} ${tag}`;
  let messageId = `<${draft.id}@doldari.local>`;
  if (!smtpConfigured()) throw new Error('메일 계정이 설정되지 않았습니다. 설정에서 Gmail을 연결하거나 "메일 앱으로 열기"를 쓰세요.');
  {
    transporter ??= nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass }
    });
    const info = await transporter.sendMail({ from: config.smtp.from, to: draft.to, subject, text: draft.body, messageId });
    messageId = info.messageId || messageId;
  }

  const rec: MailRecord = {
    id: messageId,
    direction: 'out',
    vendorId: draft.vendorId,
    kind: draft.kind,
    to: draft.to,
    subject,
    body: draft.body,
    at: new Date().toISOString()
  };
  recordMail(rec);
  return rec;
}
