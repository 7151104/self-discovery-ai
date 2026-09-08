/**
 * Стили продукта, как их видит страница: одна таблица `web/dist/app.css`.
 * Порядок файлов — тот же, что сборка (`base` первым, `motion` последним),
 * поэтому каскад снимка совпадает с каскадом в браузере.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { web } from "../load.js";
import { repoRoot } from "../paths.js";
import type { CaptureContext, Rule } from "./capture.js";

export async function productContext(): Promise<CaptureContext> {
  const { parseCss } = await web<{ parseCss: (source: string) => Rule[] }>("src/css.js");
  const { TOKENS, ROOT_FONT_SIZE_PX } = await web<{
    TOKENS: Record<string, string>;
    ROOT_FONT_SIZE_PX: number;
  }>("tokens/tokens.js");
  const css = readFileSync(join(repoRoot, "web/dist/app.css"), "utf8");
  return { rules: parseCss(css), tokens: TOKENS, rootFontSizePx: ROOT_FONT_SIZE_PX };
}

/** Контекст с подменёнными токенами: для проверки, что правка значения ломает снимок. */
export const withTokens = (ctx: CaptureContext, patch: Record<string, string>): CaptureContext => ({
  ...ctx,
  tokens: { ...ctx.tokens, ...patch },
});
