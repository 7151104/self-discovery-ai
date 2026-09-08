/**
 * Юридические строки для клиента: выжимка из `content/legal/`, без движка.
 *
 * Полные документы клиент не тащит: страницы читает сервер. Здесь — короткий
 * текст согласия, отпечаток версии, каталог адресов и дисклеймеры.
 */

import { copy } from "./copy.js";
import { CONSENT_SHORT, CONSENT_VERSION, DISCLAIMERS, LEGAL_DOCUMENTS } from "./generated/legal.js";

export const consentVersionOf = (): string => CONSENT_VERSION;

export const consentCopy = () => CONSENT_SHORT;

export const footerHeading = (): string => copy("UI_FOOTER_LABEL");

export const unfilledLabel = (): string => copy("UI_LEGAL_UNFILLED");

export const footerLinks = (): { label: string; href: string }[] =>
  LEGAL_DOCUMENTS.map((item) => ({ label: item.title, href: item.path }));

export const offerLegalLinks = (): { label: string; href: string }[] =>
  LEGAL_DOCUMENTS.filter((item) => item.id === "offer" || item.id === "privacy").map((item) => ({
    label: item.title,
    href: item.path,
  }));

export function disclaimersFor(places: string[]): { id: string; text: string }[] {
  const wanted = new Set(places);
  return DISCLAIMERS.filter((item) => item.where.some((place) => wanted.has(place))).map((item) => ({
    id: item.id,
    text: item.text,
  }));
}

export function disclaimerPlaces(input: { screen: string; page: { blocks: { id: string; generation: { status: string } | null }[]; offer: unknown; nextPortion: unknown } | null }): string[] {
  if (input.screen === "intro") return ["экран входа", "экран согласия"];
  const page = input.page;
  if (page === null) return [];
  const places: string[] = ["шапка страницы"];
  const ids = page.blocks.map((block) => block.id);
  if (ids.includes("step1")) places.push("блок ступени 1");
  if (ids.includes("step3")) places.push("блок ступени 3");
  if (ids.includes("step4")) places.push("блок ступени 4");
  if (ids.some((id) => id.startsWith("slice:"))) places.push("блок платного среза");
  if (page.offer !== null && page.nextPortion === null) places.push("экран оплаты");
  if (page.blocks.some((block) => block.generation?.status === "pending")) places.push("экран ожидания генерации");
  return places;
}
