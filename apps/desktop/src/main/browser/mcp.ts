// `aside mcp` (stdio JSON-RPC) 최소 클라이언트. 호출은 한 줄씩 직렬화한다.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findAsideBin(): string | null {
  const candidates = [
    process.env.ASIDE_BIN,
    path.join(os.homedir(), '.local/bin/aside'),
    '/opt/homebrew/bin/aside',
    '/usr/local/bin/aside'
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | null = null;

  constructor(private bin: string) {}

  private start() {
    this.ready ??= (async () => {
      const proc = spawn(this.bin, ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: `${path.dirname(this.bin)}:${process.env.PATH ?? ''}` } });
      this.proc = proc;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d: string) => {
        this.buf += d;
        let i: number;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i);
          this.buf = this.buf.slice(i + 1);
          try {
            const m = JSON.parse(line);
            const p = m.id !== undefined ? this.pending.get(m.id) : undefined;
            if (!p) continue;
            this.pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message ?? 'MCP 오류'));
            else p.resolve(m.result);
          } catch {
            /* 로그 줄 무시 */
          }
        }
      });
      proc.stderr.on('data', () => undefined);
      proc.on('exit', () => {
        for (const p of this.pending.values()) p.reject(new Error('Aside 연결이 끊겼습니다'));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
      });
      await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'doldari', version: '1' } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    })();
    return this.ready;
  }

  private rpc(method: string, params: unknown, timeoutMs = 130_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Aside 응답 시간 초과'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
      this.proc!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** repl 도구 실행 → console.log 출력 텍스트 */
  repl(code: string, title = 'doldari'): Promise<string> {
    const run = async () => {
      await this.start();
      const res = (await this.rpc('tools/call', { name: 'repl', arguments: { title, code } })) as {
        content?: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
      if (res.isError) throw new Error(text.slice(0, 400) || 'Aside 실행 오류');
      return text;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async listTools(): Promise<string[]> {
    await this.start();
    const r = (await this.rpc('tools/list', {})) as { tools?: { name: string }[] };
    return (r.tools ?? []).map((t) => t.name);
  }

  close() {
    this.proc?.kill();
    this.proc = null;
  }
}

/** console.log(JSON) 출력에서 마지막 마커 줄을 꺼낸다 (Aside가 붙이는 [system] 줄 무시) */
export function pickJson<T>(text: string, marker = '@@'): T {
  const line = text.split('\n').reverse().find((l) => l.startsWith(marker));
  if (!line) throw new Error(text.slice(0, 300) || '응답 없음');
  return JSON.parse(line.slice(marker.length)) as T;
}
