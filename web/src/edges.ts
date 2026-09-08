/**
 * Краевые состояния живой страницы.
 *
 * Сборка экрана одна — `renderPersonalPage`. Здесь только решение, какую
 * заметку поставить в уже существующий слот `notice`. Витрина передаёт
 * заметку явно из `EDGE_CASES`; живой клиент выводит её из состояния сервера
 * и короткого контекста визита.
 *
 * «Ответ L12 короче 15 слов» — не заметка страницы, а подсказка открытого
 * поля: она уже стоит в `portion.openHint`.
 */

import type { PageStateDto } from "./contract.js";
import { edgeTexts } from "./page-copy.js";
import type { PageNotice } from "./page.js";

export interface EdgeContext {
  /** Возврат на порцию, где часть вопросов уже сохранена. */
  returned?: boolean;
  /** Отказ от оплаты в этот визит. */
  offerDeclined?: boolean;
  /** Попытка оплаты не прошла. */
  paymentFailed?: boolean;
}

const notice = (id: string, texts: string[], tone: PageNotice["tone"] = "rest"): PageNotice => ({
  id,
  texts,
  tone,
});

const crisisNoticeFromPage = (page: PageStateDto): PageNotice | null => {
  const crisis = page.crisis;
  if (crisis !== null && crisis !== undefined) {
    const texts =
      crisis.publishable && crisis.texts.length > 0
        ? crisis.texts.map((entry) => entry.text)
        : [edgeTexts.crisis()];
    return notice("crisis", texts, "crisis");
  }
  /**
   * Моки витрины и старые ответы без поля `crisis`: ступень 4 закрыта, блока
   * сюжета нет, предложения нет — показываем краевую строку из реестра.
   */
  const hasStep4 = page.blocks.some((block) => block.id === "step4");
  if (page.state === "s4" && !hasStep4 && page.offer === null && page.nextPortion === null) {
    return notice("crisis", [edgeTexts.crisis()], "crisis");
  }
  return null;
};

export function edgeNotice(page: PageStateDto, context: EdgeContext = {}): PageNotice | null {
  const hasStep4 = page.blocks.some((block) => block.id === "step4");
  const hasStep3 = page.blocks.some((block) => block.id === "step3");
  const failed = page.blocks.some((block) => block.generation?.status === "failed");
  const stale = page.blocks.some((block) => block.stale);

  const crisisEdge = crisisNoticeFromPage(page);
  if (crisisEdge) return crisisEdge;
  if (failed) return notice("generation-failed", [edgeTexts.generationFailed()]);
  if (context.paymentFailed === true) return notice("payment-failed", [edgeTexts.paymentFailed()]);
  if (context.offerDeclined === true) return notice("pay-declined", [edgeTexts.payDeclined()]);
  if (stale) return notice("answer-changed", [edgeTexts.answerChanged()]);
  /**
   * Узел не сработал: крючок ступени 3 берётся из узла. Если узла нет, крючка
   * нет, а блок 3 на странице есть — это текст `NODE_NONE`.
   */
  if (hasStep3 && page.hook === null) return notice("no-node", [edgeTexts.noNode()]);
  if (context.returned === true) return notice("return", [edgeTexts.returned()]);
  if (page.card.theme === null) return notice("no-date", [edgeTexts.noDate()]);
  return null;
}
