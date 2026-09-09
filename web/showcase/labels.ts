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
  brandTexts,
  contactLabels,
  contactTexts,
  disagreeTexts,
  headTexts,
  offerTexts,
  portionTexts,
  publicTexts,
  readingTexts,
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
      note: mock.mapClosedNote,
      zoneLabel: mock.zoneLabel,
      fillLabels: mock.fillLabels,
    },
    route: {
      label: mock.routeLabel,
      note: routeTexts.note(),
      formatPrice: mock.formatPrice,
      tag: routeTexts.tag,
    },
    block: {
      actions: mock.blockActions,
      updated: mock.staleNote,
      diverged: blockTexts.diverged(),
      stitch: blockTexts.stitch(),
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
      title: portionTexts.title(),
      back: mock.portionLabels.back,
      scaleMarks: mock.portionLabels.scaleMarks,
      scaleHint: mock.portionLabels.scaleHint,
      openHint: mock.portionLabels.openHint,
      openSubmit: mock.portionLabels.openSubmit,
      counterText: (state) =>
        portionTexts.counter(state, page.nextPortion?.key.startsWith("slice:") === true ? 1 : SUBMIT_FROM_WORDS),
      progress: portionTexts.progress,
    },
    clarificationsTitle: (count) => offerTexts.questions(count),
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
      linkHint: headTexts.linkHint(page.url),
      emptyHook: headTexts.emptyHook(),
    },
    reading: {
      title: readingTexts.title(),
      empty: readingTexts.empty(),
    },
    public: {
      makeOwn: publicTexts.makeOwn(),
      makeOwnHint: publicTexts.makeOwnHint(),
      title: publicTexts.title(page.card.name),
    },
    brand: {
      src: brandTexts.markSrc(),
      alt: brandTexts.alt(),
    },
    contact: {
      ...contactLabels(),
      saved: contactTexts.saved(),
      later: contactTexts.later(),
    },
  };
}
