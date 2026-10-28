import { join } from 'node:path';
import { FONT_DIR } from './render.js';

/**
 * Rasterise an SVG produced by `renderSvg` into a PNG buffer.
 * @param {string} svg
 * @param {{ scale?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function svgToPng(svg, { scale = 2 } = {}) {
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: {
      fontFiles: [join(FONT_DIR, 'JetBrainsMono-Regular.ttf'), join(FONT_DIR, 'JetBrainsMono-Bold.ttf')],
      // System fonts are only a fallback for glyphs JetBrains Mono lacks (CJK, emoji, ...).
      loadSystemFonts: true,
      defaultFontFamily: 'JetBrains Mono',
      monospaceFamily: 'JetBrains Mono',
    },
    shapeRendering: 2,
    textRendering: 1,
  });
  return resvg.render().asPng();
}
