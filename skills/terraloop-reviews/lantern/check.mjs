import { readFileSync, existsSync } from 'node:fs';

const dir = process.argv[2];
const notePath = `${dir}/note.md`;
const specPath = `${dir}/lantern.json`;
const iid = dir.split('/').filter(Boolean).pop();
const motionPath = `${dir}/lantern/motion.txt`;
const pagePath = `${dir}/lantern/review-${iid}.html`;

const firstMermaid = (text) => text.match(/```mermaid\n([\s\S]*?)```/)?.[1]?.trim() ?? null;
const normalize = (src) => src.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

function verdict() {
  if (!existsSync(specPath)) return 'missing lantern.json';
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const noteMermaid = firstMermaid(readFileSync(notePath, 'utf8'));
  if (!noteMermaid) return 'note has no mermaid block';
  if (normalize(spec.mermaid ?? '') !== normalize(noteMermaid)) return 'lantern.json mermaid differs from the note';
  if (!Array.isArray(spec.steps) || spec.steps.length < 2) return 'needs at least 2 steps';
  if (!existsSync(pagePath)) return `not built: run lantern/build.sh ${iid}`;
  const motion = existsSync(motionPath) ? readFileSync(motionPath, 'utf8') : '';
  const events = motion.match(/(\d+) events/);
  if (!events) return 'motion verifier did not run';
  if (Number(events[1]) !== 0) return `motion verifier: ${events[1]} events`;
  return `ok steps=${spec.steps.length}`;
}

console.log(verdict());
