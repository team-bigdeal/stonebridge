#!/usr/bin/env node
// AI 도구 공동작업 표기(Co-Authored-By: Claude, Generated with Claude Code 등)를 찾거나 지운다.
//   node scripts/ai-attribution.mjs --strip <파일>   파일에서 해당 줄을 지운다 (commit-msg 훅)
//   node scripts/ai-attribution.mjs --check <파일>   해당 줄이 있으면 출력하고 exit 1 (CI)
//   node scripts/ai-attribution.mjs --check -        stdin 검사
import fs from 'node:fs';

const AI = 'claude|anthropic|copilot|cursor|codex|openai|chatgpt|gpt-?\\d|gemini|devin|aider|windsurf|codeium|tabnine|amazon q|jules';
const PATTERNS = [
  new RegExp(`^\\s*co-authored-by:.*(${AI})`, 'i'),
  new RegExp(`generated (with|by)\\b.*(${AI})`, 'i'),
  /^\s*🤖/u
];

export const isAiAttribution = (line) => PATTERNS.some((re) => re.test(line));

const [mode, file] = process.argv.slice(2);
if (!mode || !file) {
  console.error('usage: ai-attribution.mjs --strip|--check <file|->');
  process.exit(2);
}
const text = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
const lines = text.split('\n');
const hits = lines.filter(isAiAttribution);

if (mode === '--check') {
  if (hits.length) {
    console.error('AI 공동작업 표기가 있습니다 (AGENTS.md "AI 공동작업 표기 금지"):');
    for (const h of hits) console.error(`  ${h.trim()}`);
    process.exit(1);
  }
  process.exit(0);
}

if (mode === '--strip') {
  if (!hits.length) process.exit(0);
  const kept = lines.filter((l) => !isAiAttribution(l));
  // 지운 뒤 끝에 남는 빈 줄 정리
  while (kept.length > 1 && kept[kept.length - 1].trim() === '' && kept[kept.length - 2].trim() === '') kept.pop();
  fs.writeFileSync(file, kept.join('\n'));
  console.error(`commit-msg: AI 공동작업 표기 ${hits.length}줄을 지웠습니다.`);
  process.exit(0);
}

console.error(`알 수 없는 모드: ${mode}`);
process.exit(2);
