import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Retain the previous weight matching while sharing one WOFF2 per character subset.
// Korean 600/800 still match 700/900; other families retain their full range.
const fonts = [
  { path: '/@fontsource-variable/inter/wght.css', family: 'Inter', weights: ['100 900'] },
  { path: '/@fontsource-variable/noto-sans/wght.css', family: 'Noto Sans', weights: ['100 900'] },
  { path: '/@fontsource-variable/noto-sans-kr/wght.css', family: 'Noto Sans KR', weights: ['400 500', '700', '900'] },
  { path: '/@fontsource-variable/noto-sans-sc/wght.css', family: 'Noto Sans SC', weights: ['100 900'] },
  { path: '/@fontsource-variable/noto-sans-jp/wght.css', family: 'Noto Sans JP', weights: ['100 900'] },
  { path: '/@fontsource-variable/noto-sans-devanagari/wght.css', family: 'Noto Sans Devanagari', weights: ['100 900'] },
  { path: '/@fontsource-variable/noto-sans-thai/wght.css', family: 'Noto Sans Thai', weights: ['100 900'] },
];

export function fontAssets() {
  return {
    name: 'tallyfin-font-assets',
    enforce: 'pre',
    generateBundle() {
      for (const font of fonts) {
        const packageName = font.path.slice(1, -'/wght.css'.length);
        this.emitFile({ type: 'asset', fileName: `fonts/${packageName.split('/')[1]}-OFL.txt`,
          source: readFileSync(require.resolve(`${packageName}/LICENSE`), 'utf8') });
      }
    },
    transform(css, id) {
      const path = id.split('?')[0].replaceAll('\\', '/');
      const font = fonts.find(candidate => path.endsWith(candidate.path));
      if (!font) return null;
      const faces = css.match(/@font-face\s*\{[^}]+\}/g);
      if (!faces?.length) throw new Error(`No font faces in ${font.family}`);
      const code = faces.flatMap(face => {
        const range = face.match(/font-weight:\s*(\d+)\s+(\d+)\s*;/);
        if (!range || Number(range[1]) > 400 || Number(range[2]) < 900 ||
            !/font-style:\s*normal\s*;/.test(face) || !/unicode-range:/.test(face) ||
            !/font-family:\s*['"][^'"]+['"]\s*;/.test(face) || !/\.woff2\)/.test(face)) {
          throw new Error(`Unsupported variable font face in ${font.family}`);
        }
        return font.weights.map(weight => face
          .replace(/font-family:\s*['"][^'"]+['"]\s*;/, `font-family: '${font.family}';`)
          .replace(range[0], `font-weight: ${weight};`));
      }).join('\n');
      return { code, map: null };
    },
  };
}
