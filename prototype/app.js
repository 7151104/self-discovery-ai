// Кликабельный прототип личной страницы. Вся логика — в engine/, здесь только рендер.
// Порядок блоков и поведение — docs/11-ui-page-spec.md.

import { buildPage, uiCopy } from "/engine/dist/index.js";
// Состав среза приходит из его файла, а не из микрокопии: у каждой двери он свой
// (content/slices/*.md, раздел «Экран оплаты»).
import { payContents } from "/engine/dist/pay-screens.js";

const STORE_KEY = "self-discovery-prototype";

/** Порог открытого ответа: тот же, что в движке (content/questions-ladder.md). */
const OPEN_MIN_WORDS = 15;

const state = {
  person: null,
  answers: {},
  /** Индекс вопроса внутри текущей порции. */
  cursor: 0,
  collecting: false,
  declined: [],
  offerDeclined: false,
  internal: false,
};

const app = document.getElementById("app");

// ── Хранение ──────────────────────────────────────────────────

function save() {
  const { person, answers, declined, offerDeclined } = state;
  localStorage.setItem(STORE_KEY, JSON.stringify({ person, answers, declined, offerDeclined }));
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (!saved?.person) return;
    Object.assign(state, {
      person: saved.person,
      answers: saved.answers ?? {},
      declined: saved.declined ?? [],
      offerDeclined: Boolean(saved.offerDeclined),
    });
  } catch {
    localStorage.removeItem(STORE_KEY);
  }
}

// ── Мелкие помощники ──────────────────────────────────────────

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const words = (text) => (text ?? "").trim().split(/\s+/).filter(Boolean).length;

// ── Экран входа (ступень 0) ───────────────────────────────────

function renderIntro() {
  const form = el("form", "intro");
  form.append(
    el("h1", "intro__title", uiCopy("UI_INTRO_TITLE")),
    el(
      "p",
      "hint",
      uiCopy("UI_INTRO_ABOUT"),
    ),
  );

  const nameField = el("div", "field");
  const nameLabel = el("label", null, uiCopy("UI_INTRO_NAME_LABEL"));
  nameLabel.htmlFor = "name";
  const nameInput = el("input");
  nameInput.id = "name";
  nameInput.required = true;
  nameInput.maxLength = 40;
  nameInput.autocomplete = "given-name";
  nameInput.placeholder = uiCopy("UI_INTRO_NAME_PLACEHOLDER");
  const nameHint = el("span", "hint", "");
  nameField.append(nameLabel, nameInput, nameHint);

  const dateField = el("div", "field");
  const dateLabel = el("label", null, uiCopy("UI_INTRO_DATE_LABEL"));
  dateLabel.htmlFor = "birth";
  const dateInput = el("input");
  dateInput.id = "birth";
  dateInput.type = "date";
  dateField.append(dateLabel, dateInput, el("span", "hint", uiCopy("UI_INTRO_DATE_HINT")));

  const submit = el("button", "primary", uiCopy("UI_INTRO_SUBMIT"));
  submit.type = "submit";

  form.append(nameField, dateField, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameHint.textContent = uiCopy("UI_INTRO_NAME_REQUIRED");
      return;
    }
    state.person = { name, birthDate: dateInput.value || undefined };
    state.cursor = 0;
    save();
    render();
  });

  app.replaceChildren(form);
}

// ── Части страницы ────────────────────────────────────────────

function renderHead(card) {
  const head = el("header", "head");
  head.append(el("div", "head__name", card.name));
  if (card.theme) {
    head.append(el("div", "head__theme", uiCopy("UI_HEAD_PERIOD", { тема: card.theme.toLowerCase() })));
    if (card.metaphor) head.append(el("div", "head__metaphor", card.metaphor));
  }
  return head;
}

function renderMap(bars) {
  const map = el("section", "map");
  map.append(el("div", "map__title", uiCopy("UI_MAP_TITLE")));

  for (const bar of bars) {
    const row = el("div", `bar bar--${bar.state}`);
    const head = el("div", "bar__head");
    head.append(el("div", "bar__label", bar.label), el("div", "bar__hint", bar.hint));
    row.append(head);

    if (bar.category) {
      const chips = el("div", "chips");
      for (const option of bar.category.options) {
        const short = option.replace(new RegExp(`^${uiCopy("UI_MAP_VULNERABILITY_PREFIX")}\\s+`, "i"), "");
        chips.append(el("span", `chip${option === bar.category.selected ? " chip--on" : ""}`, short));
      }
      row.append(chips);
    } else {
      const track = el("div", "bar__track");
      if (bar.position !== null) {
        const marker = el("div", "bar__marker");
        marker.style.left = `${Math.round(bar.position * 100)}%`;
        track.append(marker);
      }
      row.append(track);
      if (bar.poles) {
        const poles = el("div", "bar__poles");
        poles.append(el("span", null, bar.poles.low), el("span", null, bar.poles.high));
        row.append(poles);
      }
    }
    map.append(row);
  }
  return map;
}

function renderBlock(block) {
  const section = el("section", "block");
  section.dataset.step = String(block.step);
  section.append(el("h2", "block__title", block.heading));

  for (const paragraph of block.paragraphs) section.append(el("p", "block__text", paragraph));

  if (block.source === "llm" && !block.paragraphs.length) {
    section.append(
      el(
        "div",
        "block__llm",
        uiCopy("UI_DEV_STEP4_STUB"),
      ),
    );
  }

  if (block.highlight) section.append(el("p", "block__highlight", block.highlight));

  const foot = el("div", "block__foot");
  const disagree = el("button", "linkish", uiCopy(state.declined.includes(block.step) ? "UI_BLOCK_DISAGREE_DONE" : "UI_BLOCK_DISAGREE"));
  disagree.type = "button";
  disagree.disabled = state.declined.includes(block.step);
  disagree.addEventListener("click", () => {
    state.declined.push(block.step);
    save();
    render();
  });
  const share = el("button", "linkish", uiCopy("UI_BLOCK_SHARE"));
  share.type = "button";
  share.addEventListener("click", () => {
    share.textContent = uiCopy("UI_BLOCK_SHARE_DONE");
  });
  foot.append(disagree, share);
  section.append(foot);

  return section;
}

function renderPortion(portion) {
  const card = el("section", "portion");

  if (state.collecting) {
    card.append(el("div", "collecting", uiCopy("UI_WAIT_COLLECTING")));
    return card;
  }

  const question = portion.questions[state.cursor];
  if (!question) return card;

  card.append(el("div", "portion__lead", portion.lead));

  const dots = el("div", "dots");
  portion.questions.forEach((_, index) => dots.append(el("span", `dot${index <= state.cursor ? " dot--on" : ""}`)));
  card.append(dots, el("div", "question", question.text));

  const answer = (value) => {
    state.answers[question.id] = value;
    if (state.cursor < portion.questions.length - 1) {
      state.cursor += 1;
      save();
      render();
      return;
    }
    state.collecting = true;
    save();
    render();
    // Пауза перед показом блока: мгновенный ответ обесценивает результат.
    setTimeout(() => {
      state.collecting = false;
      state.cursor = 0;
      render();
      const blocks = document.querySelectorAll(".block");
      blocks[blocks.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 750);
  };

  if (question.type === "выбор") {
    const options = el("div", "options");
    for (const option of question.options) {
      const button = el("button", "option", option.text);
      button.type = "button";
      button.addEventListener("click", () => answer(option.key));
      options.append(button);
    }
    card.append(options);
  }

  if (question.type === "шкала") {
    const scale = el("div", "scale");
    for (let value = 1; value <= 5; value += 1) {
      const button = el("button", "scale__step", "·".repeat(value));
      button.type = "button";
      button.setAttribute("aria-label", uiCopy("UI_PORTION_SCALE_ARIA", { значение: value }));
      button.addEventListener("click", () => answer(value));
      scale.append(button);
    }
    const poles = el("div", "scale__poles");
    poles.append(el("span", null, question.scale?.low ?? ""), el("span", null, question.scale?.high ?? ""));
    card.append(scale, poles);
  }

  if (question.type === "открытый") {
    const area = el("textarea");
    area.placeholder = uiCopy("UI_OPEN_PLACEHOLDER");
    const counter = el("div", "hint", "");
    const submit = el("button", "primary", uiCopy("UI_OPEN_SUBMIT"));
    submit.type = "button";
    submit.disabled = true;

    area.addEventListener("input", () => {
      const count = words(area.value);
      counter.textContent = count >= 5 ? uiCopy("UI_OPEN_COUNTER_SHORT", { слов: count, минимум: OPEN_MIN_WORDS }) : "";
      if (count >= OPEN_MIN_WORDS) counter.textContent = uiCopy("UI_OPEN_COUNTER", { слов: count });
      submit.disabled = count < OPEN_MIN_WORDS;
    });
    submit.addEventListener("click", () => answer(area.value.trim()));
    card.append(area, counter, submit);
  }

  if (state.cursor > 0) {
    const back = el("button", "linkish back", uiCopy("UI_PORTION_BACK"));
    back.type = "button";
    back.addEventListener("click", () => {
      state.cursor -= 1;
      render();
    });
    card.append(back);
  }

  return card;
}

function renderOffer(offer, name) {
  const card = el("section", "offer");
  card.append(
    el("p", "offer__text", uiCopy("UI_PAY_LEAD", { имя: name })),
    el("p", "offer__text", offer.promise),
  );

  const button = el("button", "primary", uiCopy("UI_PAY_BUTTON", { цена: offer.price }));
  button.type = "button";
  button.addEventListener("click", () => {
    button.textContent = uiCopy("UI_PAY_QUESTIONS", { вопросов: offer.questionCount });
    button.disabled = true;
  });

  const decline = el("button", "linkish offer__decline", uiCopy("UI_PAY_DECLINE"));
  decline.type = "button";
  decline.addEventListener("click", () => {
    state.offerDeclined = true;
    save();
    render();
  });

  card.append(
    button,
    el("div", "offer__label", uiCopy("UI_PAY_CONTENTS_LABEL")),
    el("div", "offer__meta", payContents(offer.slice)),
    decline,
  );
  return card;
}

function renderRoute(doors) {
  const route = el("section", "route");
  route.append(el("div", "route__title", uiCopy("UI_ROUTE_TITLE")));

  const tag = {
    open: uiCopy("UI_ROUTE_TAG_OPEN"),
    opens_with_answers: uiCopy("UI_ROUTE_TAG_OPENS"),
    paid: uiCopy("UI_ROUTE_TAG_PAID"),
  };
  for (const door of doors) {
    const row = el("div", `door door--${door.state}`);
    row.append(el("span", null, door.title));
    row.append(el("span", "door__tag", door.price ? `${door.price} ₽` : tag[door.state]));
    route.append(row);
  }
  return route;
}

function renderInternal(page) {
  const summary = {
    step: page.step,
    dominant_node: page.internalProfile.dominantNode,
    next_paid_offer: page.internalProfile.nextPaidOffer,
    flags: page.internalProfile.flags,
    nodes: page.internalProfile.nodes.map((node) => `${node.id} (priority ${node.priority})`),
    coordinates: Object.values(page.internalProfile.coordinates).map((coordinate) =>
      coordinate.sources.length
        ? `${coordinate.id} ${coordinate.name}: ${coordinate.value} · ${coordinate.confidence} · ${coordinate.sources.join(", ")}`
        : `${coordinate.id} ${coordinate.name}: closed`,
    ),
    llm_task: page.llmTask ? `${page.llmTask.prompt.slice(0, 160)}…` : null,
  };
  return el("pre", "internal", JSON.stringify(summary, null, 2));
}

// ── Сборка ────────────────────────────────────────────────────

function render() {
  if (!state.person) {
    renderIntro();
    return;
  }

  const page = buildPage(state.person, state.answers);
  const parts = [renderHead(page.card)];

  if (page.hook) parts.push(el("section", "hook", page.hook));
  parts.push(renderMap(page.map));

  for (const block of page.blocks) parts.push(renderBlock(block));

  if (page.nextPortion) parts.push(renderPortion(page.nextPortion));
  if (page.offer && !state.offerDeclined) parts.push(renderOffer(page.offer, page.card.name));

  parts.push(renderRoute(page.doors));
  if (state.internal) parts.push(renderInternal(page));

  app.replaceChildren(...parts);
}

document.querySelector('[data-action="toggle-internal"]').addEventListener("click", () => {
  state.internal = !state.internal;
  render();
});

document.querySelector('[data-action="reset"]').addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  Object.assign(state, { person: null, answers: {}, cursor: 0, declined: [], offerDeclined: false, collecting: false });
  render();
});

// Разметка тоже без русских строк: текст приходит по идентификатору из data-copy.
for (const node of document.querySelectorAll("[data-copy]")) {
  node.textContent = uiCopy(node.dataset.copy);
}

restore();
render();
