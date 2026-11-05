// .env 로드와 설정값. API 키는 main 프로세스에서만 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import dotenv from 'dotenv';
import type { AppConfig, SettingsInput, ThemeMode } from '@shared/types';
import { getBackend } from './browser';
import { googleAccount, googleClientConfigured } from './channels/google-auth';

// 빌드한 앱(이름 "돌다리")도 개발 때와 같은 데이터 폴더를 써서 견적 히스토리·설정을 같이 본다
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'doldari-desktop'));

/** 설정 파일: 개발 중엔 레포 루트 .env, 패키징 후엔 사용자 데이터 폴더 */
const repoRoot = path.resolve(__dirname, '../../../..');
export const envFile = fs.existsSync(path.join(repoRoot, 'package.json'))
  ? path.join(repoRoot, '.env')
  : path.join(app.getPath('userData'), '.env');

if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true } as dotenv.DotenvConfigOptions);

const env = process.env;

function fromEnv() {
  return {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || '',
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5',
    effort: (env.ANTHROPIC_EFFORT?.trim() || 'low') as 'low' | 'medium' | 'high',
    smtp: {
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT || 465),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || env.SMTP_USER || ''
    },
    imap: {
      host: env.IMAP_HOST || 'imap.gmail.com',
      port: Number(env.IMAP_PORT || 993),
      user: env.IMAP_USER || env.SMTP_USER || '',
      pass: env.IMAP_PASS || env.SMTP_PASS || ''
    }
  };
}

export const config = fromEnv();

const SETTING_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'SMTP_USER', 'SMTP_PASS', 'IMAP_USER', 'IMAP_PASS', 'BROWSER_BACKEND', 'THEME', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'
] as const;

/** 화면 테마 설정. 값이 이상하면 system */
export function themeMode(): ThemeMode {
  const v = env.THEME?.trim();
  return v === 'light' || v === 'dark' ? v : 'system';
}

const quote = (v: string) => (/^[\w@.\-:/+=]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

function writeEnv(update: (lines: string[]) => string[]) {
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : [];
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, update(lines).join('\n'), { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
}

/** 설정 창 입력을 .env에 저장하고 바로 반영한다. 빈 문자열은 "변경 안 함" */
export function saveSettings(patch: SettingsInput) {
  writeEnv((lines) => {
    for (const key of SETTING_KEYS) {
      const value = patch[key]?.trim();
      if (!value) continue;
      const line = `${key}=${quote(value)}`;
      const idx = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
      if (idx >= 0) lines[idx] = line;
      else lines.push(line);
      env[key] = value;
    }
    return lines;
  });
  Object.assign(config, fromEnv());
}

export function clearApiKey() {
  writeEnv((lines) => lines.map((l) => (/^\s*ANTHROPIC_API_KEY\s*=/.test(l) ? 'ANTHROPIC_API_KEY=' : l)));
  env.ANTHROPIC_API_KEY = '';
  Object.assign(config, fromEnv());
}

/** 메일을 보내는 방법: Google 계정 연결이 있으면 그것, 없으면 앱 비밀번호 */
export const mailAuth = (): AppConfig['mailAuth'] => (googleAccount() ? 'google' : config.smtp.user && config.smtp.pass ? 'password' : null);
/** 메일을 보내는 주소 */
export const mailUser = () => googleAccount() ?? config.smtp.user;
export const smtpConfigured = () => mailAuth() !== null;
export const imapConfigured = () => Boolean(googleAccount()) || Boolean(config.imap.user && config.imap.pass);
export const hasApiKey = () => Boolean(config.apiKey);

export function publicConfig(): AppConfig {
  return {
    theme: themeMode(),
    browser: getBackend(),
    browserPref: env.BROWSER_BACKEND === 'electron' ? 'electron' : 'auto',
    hasApiKey: hasApiKey(),
    model: config.model,
    smtpConfigured: smtpConfigured(),
    imapConfigured: imapConfigured(),
    smtpUser: config.smtp.user,
    mailAuth: mailAuth(),
    mailUser: mailUser(),
    googleUser: googleAccount(),
    googleClient: googleClientConfigured()
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
