import {
  Scene, Text, FadeIn, FadeOut, Indicate, LaggedStart, flowchart, UP, DOWN, GREY, RED, GREEN,
} from '../src/index.ts';
import type { SceneClass, Mobject } from '../src/index.ts';

export interface ReviewStep {
  name: string;
  caption: string;
  highlight?: string[];
  tone?: 'finding' | 'fixed';
}

export interface ReviewSpec {
  title: string;
  mermaid: string;
  steps: ReviewStep[];
  state?: Record<string, unknown>;
}

const toneColor = (tone: ReviewStep['tone']): string => (tone === 'fixed' ? GREEN : RED);

export function reviewScene(spec: ReviewSpec): SceneClass {
  return class ReviewScene extends Scene {
    override async construct() {
      this.state = { ...(spec.state ?? {}) };
      await this.step('diagram');
      const title = new Text(spec.title, { fontSize: 0.36, weight: 'bold' }).toEdge(UP, 0.4);
      await this.play(new FadeIn(title));
      const chart = flowchart(spec.mermaid, { width: 14.4, height: 5.6, fontSize: 0.34 });
      for (const stage of chart.reveal()) await this.play(new LaggedStart(stage, { lagRatio: 0.15 }));
      let caption: Mobject | null = null;
      for (const s of spec.steps) {
        await this.step(s.name, { caption: s.caption });
        const next = new Text(s.caption, { fontSize: 0.3, color: GREY }).toEdge(DOWN, 0.5);
        if (caption) await this.play(new FadeOut(caption), { runTime: 0.25 });
        await this.play(new FadeIn(next));
        caption = next;
        const targets = (s.highlight ?? []).map((id) => chart.node(id)?.shape).filter((m): m is NonNullable<typeof m> => Boolean(m));
        if (targets.length) {
          await this.play(...targets.map((m) => new Indicate(m, { color: toneColor(s.tone) })), { runTime: 0.9 });
          await this.play(...targets.map((m) => m.animate.setStroke(toneColor(s.tone))), { runTime: 0.4 });
        }
        (this.state as Record<string, unknown>).step = s.name;
        await this.wait(0.6);
      }
    }
  };
}
