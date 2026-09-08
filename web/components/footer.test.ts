/**
 * Подвал со ссылками на документы.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { findAll, visibleText } from "../src/dom.js";
import { boxOf, componentLookup } from "../src/test-support.js";
import { renderFooter } from "./footer.js";

const node = () =>
  renderFooter({
    heading: "Docs",
    links: [
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Offer", href: "/legal/offer" },
    ],
  });

test("подвал держит постоянные адреса документов", () => {
  const hrefs = findAll(node(), "a").map((item) => String(item.attrs["href"]));
  assert.deepEqual(hrefs, ["/legal/privacy", "/legal/offer"]);
  assert.ok(visibleText(node()).includes("Docs"));
});

test("ссылка в подвале не меньше 44 px", () => {
  const box = boxOf(componentLookup(), "site-footer__link");
  assert.ok((box.height ?? 0) >= 44, `site-footer__link: ${box.height}`);
});
