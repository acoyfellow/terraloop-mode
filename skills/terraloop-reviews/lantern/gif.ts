import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { renderAt, SnapshotSink, traceScene } from '../src/index.ts';
import { SCENES } from '../scenes/index.ts';
import { launch } from './lib/browser.ts';

const [name, out, fpsArg = '10', widthArg = '800'] = process.argv.slice(2);
const entry = name == null ? undefined : SCENES[name];
if (!entry || !out) {
  console.error('usage: node tools/gif.ts <scene> <out.gif> [fps] [width]');
  process.exit(2);
}

const fps = Number(fpsArg);
const width = Number(widthArg);
const height = Math.round((width * 9) / 16);
const holdSeconds = 1.5;
const { Scene } = entry;
const trace = await traceScene(Scene);
const frameCount = Math.ceil(trace.duration * fps);
const framesDir = `${out}.frames`;
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width, height } });
for (let i = 0; i <= frameCount; i++) {
  const t = Math.min(trace.duration - 0.001, i / fps);
  const sink = new SnapshotSink({ width });
  await renderAt(Scene, t, sink);
  await page.setContent(`<style>body{margin:0;background:#111}svg{display:block}</style>${sink.svg}`);
  await page.screenshot({ path: `${framesDir}/f${String(i).padStart(4, '0')}.png` });
}
await browser.close();

const palette = `${framesDir}/palette.png`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${framesDir}/f%04d.png`, '-vf', 'palettegen=max_colors=64:stats_mode=diff', palette]);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${framesDir}/f%04d.png`, '-i', palette,
  '-lavfi', `tpad=stop_mode=clone:stop_duration=${holdSeconds}[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle`,
  '-loop', '0', out,
]);
rmSync(framesDir, { recursive: true, force: true });
console.log(`${out}: ${frameCount + 1} frames at ${fps} fps, ${width}x${height}`);
