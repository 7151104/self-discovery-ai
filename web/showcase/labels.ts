/**
 * Готовые строки для сборки страницы витрины.
 *
 * Компоненты текстов не знают. Здесь состояние страницы превращается в
 * параметры: микрокопия из реестра, состав среза — из мока (он живёт
 * в файле среза, не в реестре).
 */

import type { PageStateDto } from "../src/contract.js";
import { SUBMIT_FROM_WORDS } from "../components/open-field.js";
import {
  blockTexts,
  disagreeTexts,
  headTexts,
  offerTexts,
  portionTexts,
  publicTexts,
  routeTexts,
  waitTexts,
} from "../src/page-copy.js";
import type { PageViewLabels } from "./page.js";
import * as mock from "./mocks.js";

export function viewLabels(page: PageStateDto): PageViewLabels {
  const offer = page.offer?.slice === mock.nextOffer.slice ? mock.nextOffer : mock.offer;
  return {
    map: {
      label: mock.mapLabel,
      zoneLabel: mock.zoneLabel,
      fillLabels: mock.fillLabels,
    },
    route: {
      label: mock.routeLabel,
      formatPrice: mock.formatPrice,
      tag: routeTexts.tag,
    },
    block: {
      actions: mock.blockActions,
      updated: mock.staleNote,
      diverged: blockTexts.diverged(),
      disagreeDone: blockTexts.disagreeDone(),
      disagreeTitle: disagreeTexts.title(),
      disagreeEffect: disagreeTexts.effect(),
      disagreeKinds: disagreeTexts.kinds(),
      acknowledged: blockTexts.acknowledged(),
    },
    offer: {
      buy: offerTexts.buy(offer.price),
      contents:
        offer.contents.length > 0 ? offerTexts.contents(offer.contents) : offerTexts.contentsLabel(),
      decline: offer.decline || offerTexts.decline(),
      oneDoor: offerTexts.oneDoor(),
    },
    portion: {
      back: mock.portionLabels.back,
      scaleMarks: mock.portionLabels.scaleMarks,
      scaleHint: mock.portionLabels.scaleHint,
      openHint: mock.portionLabels.openHint,
      openSubmit: mock.portionLabels.openSubmit,
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
    head: { period: headTexts.period, noPeriod: headTexts.noPeriod() },
    public: {
      makeOwn: publicTexts.makeOwn(),
      makeOwnHint: publicTexts.makeOwnHint(),
      title: publicTexts.title(page.card.name),
    },
  };
}
