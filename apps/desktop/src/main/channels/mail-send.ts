// 메일 발송 (nodemailer, SMTP). 사용자가 "보내기"를 눌렀을 때만 호출된다.
// Google 계정이 연결돼 있으면 그 계정으로(XOAUTH2), 아니면 앱 비밀번호로 보낸다.
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { MailDraft, MailRecord } from '@shared/types';
import { isDemoAddress } from '@shared/mail';
import { config, mailAuth } from '../config';
import { emit } from '../events';
import { googleAccessToken, googleAccount } from './google-auth';

export const mailbox: MailRecord[] = [];

export function recordMail(m: MailRecord) {
  mailbox.push(m);
  emit('mail', { vendorId: m.vendorId, payload: m });
}

/** 회신을 같은 스레드로 찾기 위한 제목 태그 */
export const subjectTag = (draft: Pick<MailDraft, 'vendorId' | 'id'>) => `[돌다리#${draft.vendorId}-${draft.id.slice(0, 6)}]`;

const NOT_CONNECTED = '메일 계정이 연결되지 않았어요. 설정에서 Google 계정을 연결하거나 "메일 앱으로 열기"를 쓰세요.';

/** 지금 연결된 계정의 SMTP 설정. 설정을 바꾸면 바로 반영되도록 보낼 때마다 만든다 */
async function smtp(): Promise<{ options: SMTPTransport.Options; from: string; user: string }> {
  const auth = mailAuth();
  if (auth === 'google') {
    const user = googleAccount()!;
    return { user, from: user, options: { host: 'smtp.gmail.com', port: 465, secure: true, auth: { type: 'OAuth2', user, accessToken: await googleAccessToken() } } };
  }
  if (auth === 'password') {
    const { host, port, user, pass, from } = config.smtp;
    return { user, from, options: { host, port, secure: port === 465, auth: { user, pass } } };
  }
  throw new Error(NOT_CONNECTED);
}

function smtpError(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'EAUTH') {
    return mailAuth() === 'google'
      ? 'Gmail 로그인에 실패했어요. 설정에서 Google 계정을 다시 연결해 주세요.'
      : 'Gmail 로그인에 실패했어요. 설정에서 메일 주소와 앱 비밀번호를 확인해 주세요.';
  }
  return `메일을 보내지 못했어요: ${err.message ?? String(e)}`;
}

/** 시연용 주소(.test)는 계정이 없어도 보낸 것으로 처리한다 (회신은 orchestrator가 흉내 냄) */
export async function sendMail(draft: MailDraft): Promise<MailRecord> {
  const tag = subjectTag(draft);
  const subject = draft.subject.includes(tag) ? draft.subject : `${draft.subject} ${tag}`;
  let messageId = `<${draft.id}@doldari.local>`;
  const demo = isDemoAddress(draft.to);
  if (mailAuth()) {
    const { options, from, user } = await smtp();
    const transporter = nodemailer.createTransport(options);
    try {
      const info = await transporter.sendMail({
        from,
        to: draft.to,
        subject,
        text: draft.body,
        messageId,
        // 시연용 주소는 실제로 배달될 수 없으니 내 메일함으로 받는다 (보낸편지함에는 업체 주소로 보낸 메일로 남음)
        ...(demo ? { envelope: { from: user, to: user } } : {})
      });
      messageId = info.messageId || messageId;
    } catch (e) {
      throw new Error(smtpError(e));
    } finally {
      transporter.close();
    }
  } else if (!demo) {
    throw new Error(NOT_CONNECTED);
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
