import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Match tool identities, not ordinary prose mentioning an assistant or human names.
const bot = /\b(?:codex|commandcode(?:bot)?|github[ -]?copilot|claude[ -]?code)\b|\[bot\]|<(?:codex@openai\.com|noreply@commandcode\.ai)>/i;

try {
  if (process.argv.length !== 3) throw Error('Expected one commit message file.');
  const message = readFileSync(process.argv[2], 'utf8');
  const author = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8', windowsHide: true });
  const attribution = message.split(/\r?\n/).filter(line =>
    /^\s*(?:co-authored-by|signed-off-by|generated-by):/i.test(line) ||
    /^\s*generated (?:with|by)\b/i.test(line));
  if (bot.test(author) || attribution.some(line => bot.test(line))) {
    console.error('Commit rejected: remove AI/bot attribution. Use the human author; human co-authors are allowed.');
    process.exitCode = 1;
  }
} catch {
  console.error('Commit attribution check failed: provide a readable message file inside a Git checkout.');
  process.exitCode = 1;
}
