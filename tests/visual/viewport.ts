/**
 * Ширины снимка. Браузера нет: ширина нужна, чтобы включить или выключить
 * правила `@media (min-width: …)` и `@media (hover: hover)` при разрешении
 * стилей. На базовом экране 360 px поля страницы — `--space-3`, на настольном
 * 1280 px срабатывает `min-width: 30rem` и поля становятся `--space-5`.
 *
 * Проверенные ширины из `docs/12-target-state.md`, раздел 5.4: 360 и 1280.
 */

export const VIEWPORTS = {
  mobile: { id: "mobile" as const, px: 360 },
  desktop: { id: "desktop" as const, px: 1280 },
};

export type ViewportId = keyof typeof VIEWPORTS;
export type Viewport = (typeof VIEWPORTS)[ViewportId];

export const VIEWPORT_LIST: Viewport[] = [VIEWPORTS.mobile, VIEWPORTS.desktop];

/** Порог, с которого считаем, что есть настоящий указатель и hover-правила действуют. */
export const HOVER_FROM_PX = 768;

/**
 * Применяется ли at-правило на этой ширине.
 *
 * `prefers-reduced-motion` в снимок покоя не входит: это отдельное состояние
 * системы, а не ширина. Hover — только на настольной ширине.
 */
export function mediaMatches(at: string, viewportPx: number): boolean {
  if (at.startsWith("@keyframes")) return false;
  if (!at.startsWith("@media")) return true;

  const query = at.replace(/^@media\s*/i, "").trim();
  const parts = query.split(/\s+and\s+/i).map((part) => part.replace(/^\(|\)$/g, "").trim());
  return parts.every((part) => {
    if (/prefers-reduced-motion:\s*reduce/i.test(part)) return false;
    if (/hover:\s*hover/i.test(part)) return viewportPx >= HOVER_FROM_PX;
    const min = /min-width:\s*([\d.]+)(rem|em|px)/i.exec(part);
    if (min) {
      const amount = Number(min[1]);
      const px = min[2] === "px" ? amount : amount * 16;
      return viewportPx >= px;
    }
    const max = /max-width:\s*([\d.]+)(rem|em|px)/i.exec(part);
    if (max) {
      const amount = Number(max[1]);
      const px = max[2] === "px" ? amount : amount * 16;
      return viewportPx <= px;
    }
    return true;
  });
}
