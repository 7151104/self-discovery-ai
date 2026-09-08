/**
 * Кризисный контур слоя генерации (E4-06).
 *
 * Детектор и тексты живут в движке и в `content/crisis.md`. Здесь — решение
 * «вызывать провайдера или нет» и машинная пометка тем, которые разбор
 * не трогает. Продуктовых фраз в этом файле нет: заголовки и действия
 * категорий читаются из контента.
 */

import { detectCrisis, rawExtraContent, type CrisisDecision } from "./engine.js";

/** Постановка в очередь: блокирующий кризис задание не создаёт. */
export function crisisGate(text: string): "enqueue" | "skip" {
  return detectCrisis(text).blocked ? "skip" : "enqueue";
}

/** Решение по нескольким открытым ответам: срез держит их несколько. */
export function crisisOf(texts: string[]): CrisisDecision {
  return detectCrisis(texts.filter((text) => text.trim()).join("\n"));
}

/**
 * Машинная часть задания: какие темы разбор обязан обойти.
 * Заголовки и действия — из реестра категорий, не из строк в коде.
 */
export function avoidInstruction(avoid: string[]): string | null {
  if (!avoid.length) return null;
  const lines = avoid
    .map((id) => {
      const trigger = rawExtraContent.crisis.triggers.find((item) => item.id === id);
      return trigger ? `${trigger.title}: ${trigger.action}` : null;
    })
    .filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return ["Эти темы в разборе не трогать — ни утверждением, ни вопросом, ни примером.", ...lines].join("\n");
}
