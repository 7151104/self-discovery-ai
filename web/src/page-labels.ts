/**
 * Готовые строки живой страницы: реестр микрокопии, без моков витрины.
 *
 * Компоненты текстов не знают. Здесь состояние сервера превращается в
 * параметры `renderPersonalPage`. Состав среза приходит полем `contents`
 * предложения (E7-09): он живёт в файле среза, не в реестре.
 */

import { SUBMIT_FROM_WORDS } from "../components/open-field.js";
import type { PageStateDto } from "./contract.js";
import {
  blockTexts,
  brandTexts,
  contactLabels,
  contactTexts,
  disagreeTexts,
  headTexts,
  mapTexts,
  offerTexts,
  portionTexts,
  publicTexts,
  readingTexts,
  routeTexts,
  waitTexts,
} from "./page-copy.js";
import { offerLegalLinks } from "./legal-copy.js";
import type { PageViewLabels } from "./page.js";

export function pageLabels(page: PageStateDto): PageViewLabels {
  return {
    map: {
      label: mapTexts.label(),
      note: mapTexts.closedNote(),
      zoneLabel: mapTexts.zone,
      fillLabels: mapTexts.fill(),
    },
    route: {
      label: routeTexts.label(),
      note: routeTexts.note(),
      formatPrice: routeTexts.price,
      tag: routeTexts.tag,
    },
    block: {
      actions: blockTexts.actions(),
      updated: blockTexts.updated(),
      diverged: blockTexts.diverged(),
      stitch: blockTexts.stitch(),
      disagreeDone: blockTexts.disagreeDone(),
      disagreeTitle: disagreeTexts.title(),
      disagreeEffect: disagreeTexts.effect(),
      disagreeKinds: disagreeTexts.kinds(),
      acknowledged: blockTexts.acknowledged(),
    },
    offer: {
      buy: offerTexts.buy(page.offer?.price ?? 0),
      contents:
        (page.offer?.contents.length ?? 0) > 0
          ? offerTexts.contents(page.offer?.contents ?? [])
          : offerTexts.contentsLabel(),
      decline: page.offer?.decline || offerTexts.decline(),
      oneDoor: offerTexts.oneDoor(),
      legalLead: offerTexts.legal(),
      legalLinks: offerLegalLinks(),
    },
    portion: {
      title: portionTexts.title(),
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
      linkHint: headTexts.linkHint(),
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
