/**
 * Краевые состояния витрины (E6-12).
 *
 * Девять ситуаций из `docs/11-ui-page-spec.md`, раздел «Краевые состояния».
 * Каждая — собранная страница на моках, а не список компонентов. Поле
 * `situation` дословно совпадает с первой колонкой таблицы документа:
 * тест полноты сверяет эти строки, а не отдельный список в коде.
 */

import type { BlockDto, PageStateDto } from "../src/contract.js";
import { edgeTexts } from "../src/page-copy.js";
import type { PageNotice } from "./page.js";
import * as mock from "./mocks.js";
import { pageStates } from "./page-states.js";

const notice = (id: string, texts: string[], tone: PageNotice["tone"] = "rest"): PageNotice => ({
  id,
  texts,
  tone,
});

const withBlocks = (page: PageStateDto, blocks: BlockDto[]): PageStateDto => ({ ...page, blocks });

/** Текст `NODE_NONE` из `content/step3-contradictions.md` — мок, не второй источник. */
const NODE_NONE =
  "По этим одиннадцати ответам у тебя не набралось противоречия — твои ответы складываются в одну линию без внутреннего конфликта. Это редко и означает одно из двух: либо ты действительно устроен согласованно, либо вопросов пока слишком мало, чтобы конфликт проявился. Второе вероятнее: противоречия обычно живут не в том, как человек работает, а в том, чего он избегает.";

export interface EdgeCase {
  id: string;
  /** Первая колонка таблицы «Краевые состояния» в docs/11 — сверяется тестом. */
  situation: string;
  page: PageStateDto;
  notice: PageNotice | null;
  portionIndex?: number;
  portionValue?: string | null;
}

export const EDGE_CASES: EdgeCase[] = [
  {
    id: "no-date",
    situation: "Дата не введена",
    page: {
      ...pageStates.s1,
      card: { ...mock.card, season: null, theme: null, metaphor: null },
    },
    notice: notice("no-date", [edgeTexts.noDate()]),
  },
  {
    id: "open-too-short",
    situation: "Ответ L12 короче 15 слов",
    page: pageStates.s3,
    notice: null,
    portionValue: mock.openQuestion.short,
  },
  {
    id: "crisis",
    situation: "Кризисные признаки в L12",
    page: {
      ...pageStates.s3,
      state: "s4",
      nextPortion: null,
      offer: null,
      doors: pageStates.s3.doors.filter((door) => door.state !== "paid"),
    },
    notice: notice(
      "crisis",
      [edgeTexts.crisis(), mock.crisisTexts.support, mock.crisisTexts.noOffer, mock.crisisTexts.stays],
      "crisis",
    ),
  },
  {
    id: "no-node",
    situation: "Ни один узел не сработал",
    page: {
      ...withBlocks(pageStates.s3, [
        pageStates.s3.blocks[0] as BlockDto,
        pageStates.s3.blocks[1] as BlockDto,
        {
          ...(pageStates.s3.blocks[2] as BlockDto),
          paragraphs: [NODE_NONE],
          highlight: null,
        },
      ]),
      hook: null,
    },
    notice: notice("no-node", [edgeTexts.noNode()]),
  },
  {
    id: "return",
    situation: "Человек ушёл на середине",
    page: {
      ...pageStates.s1,
      nextPortion: pageStates.s1.nextPortion
        ? { ...pageStates.s1.nextPortion, answered: [pageStates.s1.nextPortion.questions[0]?.id ?? "Q4"] }
        : null,
    },
    notice: notice("return", [edgeTexts.returned()]),
    portionIndex: 1,
  },
  {
    id: "pay-declined",
    situation: "Отказ от оплаты",
    page: {
      ...pageStates.s4,
      offer: null,
      doors: pageStates.s3.doors,
    },
    notice: notice("pay-declined", [edgeTexts.payDeclined()]),
  },
  {
    id: "answer-changed",
    situation: "Изменение ответа",
    page: withBlocks(pageStates.paidDone, pageStates.paidDone.blocks.map((block) => ({ ...block, stale: true }))),
    notice: notice("answer-changed", [edgeTexts.answerChanged()]),
  },
  {
    id: "payment-failed",
    situation: "Оплата не прошла",
    page: pageStates.s4,
    notice: notice("payment-failed", [edgeTexts.paymentFailed()]),
  },
  {
    id: "generation-failed",
    situation: "Текст среза не собрался",
    page: withBlocks(
      pageStates.paidWaiting,
      pageStates.paidWaiting.blocks.map((block) =>
        block.generation?.status === "pending"
          ? { ...block, generation: { id: "g-1", status: "failed" } }
          : block,
      ),
    ),
    notice: notice("generation-failed", [edgeTexts.generationFailed()]),
  },
];
