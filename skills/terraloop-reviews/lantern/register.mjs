import { readFileSync, writeFileSync } from 'node:fs';

const [indexPath, iid] = process.argv.slice(2);
const name = `review-${iid}`;
const specModule = indexPath.replace(/index\.ts$/, `${name}.spec.ts`);
const specJson = readFileSync(indexPath.replace(/index\.ts$/, `${name}.json`), 'utf8');
writeFileSync(specModule, `import type { ReviewSpec } from './review-scene.ts';\nexport const spec: ReviewSpec = ${specJson.trim()};\n`);

let src = readFileSync(indexPath, 'utf8');
const ident = `review${iid}`;
if (!src.includes("from './review-scene.ts'")) src = `import { reviewScene } from './review-scene.ts';\n` + src;
if (!src.includes(`from './${name}.spec.ts'`)) src = `import { spec as ${ident} } from './${name}.spec.ts';\n` + src;
if (!src.includes(`'${name}':`)) {
  src = src.replace(
    /export const SCENES: Record<string, SceneEntry> = \{\n/,
    (m) => `${m}  '${name}': { label: ${ident}.title, Scene: reviewScene(${ident}) },\n`,
  );
}
writeFileSync(indexPath, src);
