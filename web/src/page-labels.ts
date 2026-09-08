/**
 * Готовые строки живой страницы: реестр микрокопии, без моков витрины.
 *
 * Компоненты текстов не знают. Здесь состояние сервера превращается в
 * параметры `renderPersonalPage`. Состав среза в контракте отдельного поля
 * не имеет — на экране остаётся подпись «Что внутри» до E7-09.
 */

import { SUBMIT_FROM_WORDS } from "../components/open-field.js";
import type { PageStateDto } from "./contract.js";
import {
  blockTexts,
  disagreeTexts,
  headTexts,
  mapTexts,
  offerTexts,
  portionTexts,
  publicTexts,
  routeTexts,
  waitTexts,
} from "./page-copy.js";
import { offerLegalLinks } from "./legal-copy.js";
import type { PageViewLabels } from "./page.js";

export function pageLabels(page: PageStateDto): PageViewLabels {
  return {
    map: {
      label: mapTexts.label(),
      zoneLabel: mapTexts.zone,
      fillLabels: mapTexts.fill(),
    },
    route: {
      label: routeTexts.label(),
      formatPrice: routeTexts.price,
      tag: routeTexts.tag,
    },
    block: {
      actions: blockTexts.actions(),
      updated: blockTexts.updated(),
      diverged: blockTexts.diverged(),
      disagreeDone: blockTexts.disagreeDone(),
      disagreeTitle: disagreeTexts.title(),
      disagreeEffect: disagreeTexts.effect(),
      disagreeKinds: disagreeTexts.kinds(),
      acknowledged: blockTexts.acknowledged(),
    },
    offer: {
      buy: offerTexts.buy(page.offer?.price ?? 0),
      contents: offerTexts.contentsLabel(),
      decline: offerTexts.decline(),
      oneDoor: offerTexts.oneDoor(),
      legalLead: offerTexts.legal(),
      legalLinks: offerLegalLinks(),
    },
    portion: {
      back: portionTexts.back(),
      scaleMarks: [
        portionTexts.scaleMark(1),
        portionTexts.scaleMark(2),
        portionTexts.scaleMark(3),
        portionTexts.scaleMark(4),
        portionTexts.scaleMark(5),
      ],
      scaleHint: portionTexts.scaleHint(),
      openHint: portionTexts.openTooShort(),
      openSubmit: portionTexts.openSubmit(),
      counterText: (state) => portionTexts.counter(state, SUBMIT_FROM_WORDS),
      progress: portionTexts.progress,
    },
    wait: {
      title: waitTexts.title,
      topics: waitTexts.topics,
      longNote: waitTexts.longNote,
      resumedNote: waitTexts.resumedNote,
      collecting: waitTexts.collecting(),
    },
    head: {
      period: headTexts.period,
      noPeriod: headTexts.noPeriod(),
    },
    public: {
      makeOwn: publicTexts.makeOwn(),
      makeOwnHint: publicTexts.makeOwnHint(),
      title: publicTexts.title(page.card.name),
    },
  };
}
