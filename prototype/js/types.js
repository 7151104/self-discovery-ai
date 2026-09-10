(function (global) {
  const TYPES = [
    { id: "artifact", name: "Артефакт", hint: "Всё на одной странице. Без табов. Скриншот — это и есть продукт.", theme: "slate" },
    { id: "stories", name: "Сторис", hint: "Полный экран. Тап по краям. Полоски сверху.", theme: "graphite" },
    { id: "tabs", name: "Вкладки", hint: "Привычный телефон. Я / Дальше / Карта / Ещё.", theme: "violet" },
    { id: "deck", name: "Колода", hint: "Одна полка — одна карточка. Листаешь, не скроллишь простыню.", theme: "ocean" },
    { id: "letter", name: "Письмо", hint: "Документ, не приложение. Номера разделов, бумага.", theme: "forest" },
    { id: "mapsheet", name: "Карта + шит", hint: "Полосы сверху всегда. Текст выезжает снизу.", theme: "marsala" },
    { id: "accordion", name: "Аккордеон", hint: "Плотная полка. Открыта одна. Остальное — строки.", theme: "slate" },
    { id: "reel", name: "Лента", hint: "Каждый блок — на весь экран. Свайп вверх.", theme: "graphite" },
    { id: "slides", name: "Слайды", hint: "Свайп в сторону. Атмосферный путь. Потом — в кабинет.", theme: "graphite" },
    { id: "cabinet", name: "Кабинет", hint: "Дом. Полки. Сюда возвращаешься.", theme: "slate" },
  ];

  const SKINS = [
    { id: "rain", name: "Дождь" },
    { id: "ink", name: "Тушь" },
    { id: "sea", name: "Море" },
    { id: "cinema", name: "Кино" },
    { id: "stone", name: "Камень" },
    { id: "frost", name: "Иней" },
    { id: "forest", name: "Лес" },
    { id: "violet", name: "Сумерки" },
  ];

  function data(x) {
    const h = x.stepDone(1) ? x.E.hook(x.state.answers) : "Страница уже твоя. Настоящее — после трёх вопросов.";
    const s1 = x.stepDone(1) ? x.E.step1Block(x.state.answers) : null;
    const s2 = x.stepDone(2) ? x.E.step2Block(x.state.answers) : null;
    const node = x.stepDone(3) ? x.E.nodeBlock(x.state.answers) : null;
    const syn = x.stepDone(4) ? x.E.synthesis(x.state.name, x.state.answers, node || x.E.nodeBlock(x.state.answers)) : null;
    const now = x.nowCard();
    const lit = x.mapLitCount();
    const offer = (node && node.offer) || x.C.nodes.NODE_FINISH_FEAR.offer;
    return { h, s1, s2, node, syn, now, lit, offer };
  }

  function nowBtn(now) {
    return `<button class="btn" data-act="${now.act}">${esc(now.cta)}</button>`;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function openOrLock(x, open, title, lock, body) {
    if (open) return body;
    return `<button class="door" data-act="start-portion"><span>${title}</span><span class="lock">${lock}</span></button>`;
  }

  function workHtml(x, d) {
    if (!d.s1) return openOrLock(x, false, "Как ты работаешь", "3 вопроса", "");
    return `<article class="block"><h2>Как ты работаешь</h2>${d.s1.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}${d.s1.stitch ? `<p class="lead">${esc(d.s1.stitch)}</p>` : ""}</article>`;
  }
  function hitHtml(x, d) {
    if (!d.s2) return openOrLock(x, false, "Как обрабатываешь и как тебя задевает", x.stepDone(1) ? "ещё 4 вопроса" : "после первой ступени", "");
    return `<article class="block"><h2>Как обрабатываешь и как тебя задевает</h2>${d.s2.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}${d.s2.price ? `<p class="lead">${esc(d.s2.price)}</p>` : ""}</article>`;
  }
  function nodeHtml(x, d) {
    if (!d.node) return openOrLock(x, false, "Где ты себе мешаешь", x.stepDone(2) ? "ещё 4 вопроса" : "ступень 3", "");
    return `<article class="block"><h2>Где ты себе мешаешь</h2><p class="lead">${esc(d.node.text)}</p><p class="hint">Это узел. Не решение.</p></article>`;
  }
  function plotHtml(x, d) {
    if (!d.syn) return openOrLock(x, false, "Сюжет", "один открытый вопрос", "");
    return `<article class="block"><h2>${esc(d.syn.title)}</h2><p class="lead">${esc(d.syn.plot)}</p><p>${esc(d.syn.cut)}</p></article>`;
  }
  function routeHtml(x, d) {
    return `
      <div class="${x.stepDone(4) ? "" : "quiet"}">
        <p class="section-label">${x.stepDone(4) ? "Маршрут" : "Потом, если захочешь"}</p>
        ${x.offerDoor(d.node)}
        <button class="door" data-act="toast" data-msg="Срез близости — следующая дверь после узла."><span>Как этот механизм в близких</span><span class="lock">потом</span></button>
        <button class="door" data-act="toast" data-msg="Полная карта — когда координат станет больше."><span>Полная карта</span><span class="lock">потом</span></button>
      </div>`;
  }
  function nowBox(d) {
    return `<section class="now">
      <div class="kicker">${esc(d.now.kicker)}</div>
      <h2>${esc(d.now.title)}</h2>
      <p>${esc(d.now.why)}</p>
      ${d.now.time ? `<p class="hint">${esc(d.now.time)}</p>` : ""}
      ${nowBtn(d.now)}
    </section>`;
  }
  function typeFoot() {
    return `<nav class="type-foot">
      <button data-act="tab-next">дальше</button>
      <button data-act="tab-map">карта</button>
      <button data-act="share">отправить</button>
      <button data-act="tab-more">сменить тип</button>
    </nav>`;
  }

  function pageArtifact(x) {
    const d = data(x);
    return `
      <div class="screen no-tabs t-artifact">
        <header class="art-top">
          <span class="brand">${x.C.brand}</span>
          <button class="ghost" data-act="share">отправить страницу</button>
        </header>
        <p class="art-url" data-act="copy-url">${esc(x.pageUrl())}</p>
        <p class="art-name">${esc(x.state.name)}</p>
        <h1 class="art-hook">${esc(d.h)}</h1>
        ${nowBox(d)}
        <ol class="art-ladder">
          <li class="${x.stepDone(1) ? "on" : ""}">Как работаешь</li>
          <li class="${x.stepDone(2) ? "on" : x.currentStepNum() === 2 ? "cur" : ""}">Как задевает</li>
          <li class="${x.stepDone(3) ? "on" : ""}">Узел</li>
          <li class="${x.stepDone(4) ? "on" : ""}">Сюжет</li>
        </ol>
        ${workHtml(x, d)}
        ${hitHtml(x, d)}
        ${nodeHtml(x, d)}
        ${plotHtml(x, d)}
        ${routeHtml(x, d)}
        ${typeFoot()}
      </div>`;
  }

  function storiesSlides(x, d) {
    const bands = x.stepDone(1) ? x.E.mapBands(x.state.answers).slice(0, 8) : [];
    return [
      {
        k: "фраза",
        html: `<p class="st-k">${esc(x.state.name)} · твоя страница</p>
          <h1>${esc(d.h)}</h1>
          <p class="st-sub">Удержи, если хочешь сохранить. Тап справа — дальше.</p>`,
      },
      {
        k: "сейчас",
        html: `<p class="st-k">${esc(d.now.kicker)}</p>
          <h1>${esc(d.now.title)}</h1>
          <p>${esc(d.now.why)}</p>
          <p class="hint">${esc(d.now.time || "")}</p>
          ${nowBtn(d.now)}`,
      },
      {
        k: "полка",
        html: d.s1
          ? `<p class="st-k">уже твоё</p><h1>Как ты работаешь</h1>${d.s1.paragraphs.slice(0, 2).map((p) => `<p>${esc(p)}</p>`).join("")}`
          : `<p class="st-k">закрыто</p><h1>Как ты работаешь</h1><p>Три вопроса — и эта сторис станет настоящей.</p>${nowBtn(d.now)}`,
      },
      {
        k: "дальше",
        html: `<p class="st-k">ещё не открыто</p>
          <h1>Как тебя задевает</h1>
          <p>${x.stepDone(1) ? "Ещё 4 вопроса — и эта сторис допишется." : "Сначала первая полка."}</p>
          <p class="hint">590 ₽ — не в этой сторис.</p>
          ${nowBtn(d.now)}`,
      },
      {
        k: "карта",
        html: `<p class="st-k">без процентов</p>
          <h1>Как ты устроена</h1>
          <div class="st-stripes">${bands.map((b, i) => `<i class="${i < d.lit ? "on" : ""}"></i>`).join("") || "<p>Появятся после трёх вопросов.</p>"}</div>
          <button class="btn secondary" data-act="tab-map">Открыть карту</button>`,
      },
      {
        k: "меню",
        html: `<p class="st-k">что дальше</p>
          <h1>Не тест. Страница.</h1>
          <div class="stack">
            <button class="btn" data-act="share">Отправить страницу</button>
            <button class="btn secondary" data-act="start-portion">${esc(d.now.cta)}</button>
            <button class="btn secondary" data-act="tab-more">Другой тип</button>
          </div>`,
      },
    ];
  }

  function pageStories(x) {
    const d = data(x);
    const slides = storiesSlides(x, d);
    const i = Math.max(0, Math.min(x.state.slide || 0, slides.length - 1));
    const s = slides[i];
    return `
      <div class="screen no-tabs t-stories">
        <div class="st-bars">${slides.map((_, n) => `<i class="${n <= i ? "on" : ""}"></i>`).join("")}</div>
        <div class="st-frame">
          ${s.html}
        </div>
        <button class="st-hit left" data-act="slide-prev" aria-label="назад"></button>
        <button class="st-hit right" data-act="slide-next" aria-label="дальше"></button>
        <p class="st-count">${i + 1} / ${slides.length} · ${s.k}</p>
      </div>`;
  }

  function pageTabs(x) {
    return x.pageTabs();
  }

  function deckCards(x, d) {
    return [
      { k: "Сейчас", html: nowBox(d) },
      { k: "Как работаешь", html: workHtml(x, d) },
      { k: "Как задевает", html: hitHtml(x, d) },
      { k: "Узел", html: nodeHtml(x, d) },
      { k: "Сюжет", html: plotHtml(x, d) },
      { k: "Маршрут", html: routeHtml(x, d) },
    ];
  }

  function pageDeck(x) {
    const d = data(x);
    const cards = deckCards(x, d);
    const i = Math.max(0, Math.min(x.state.card || 0, cards.length - 1));
    const c = cards[i];
    const next = cards[i + 1];
    return `
      <div class="screen no-tabs t-deck">
        <header class="dk-top">
          <div>
            <div class="brand">${x.C.brand}</div>
            <strong>${esc(x.state.name)}</strong>
          </div>
          <button class="ghost" data-act="share">↑</button>
        </header>
        <p class="dk-hook">${esc(d.h)}</p>
        <p class="dk-meta">${i + 1} / ${cards.length} · ${c.k}</p>
        <div class="dk-stack">
          ${next ? `<div class="dk-back">${esc(next.k)}</div>` : ""}
          <div class="dk-card">${c.html}</div>
        </div>
        <div class="dk-nav">
          <button class="btn secondary" data-act="deck-prev" ${i === 0 ? "disabled" : ""}>Эта назад</button>
          <button class="btn" data-act="deck-next" ${i === cards.length - 1 ? "disabled" : ""}>Следующая полка</button>
        </div>
        ${typeFoot()}
      </div>`;
  }

  function pageLetter(x) {
    const d = data(x);
    const date = x.state.date && !x.state.skipDate ? x.E.formatDate(x.state.date) : "";
    return `
      <div class="screen no-tabs t-letter">
        <div class="paper">
          <header class="lt-head">
            <span>${x.C.brand}</span>
            <span>${esc(date || x.pageUrl())}</span>
          </header>
          <p class="lt-to">${esc(x.state.name)}</p>
          <p class="lt-hook">${esc(d.h)}</p>
          <aside class="lt-note">
            <b>${esc(d.now.title)}</b>
            <span>${esc(d.now.why)}</span>
            ${nowBtn(d.now)}
          </aside>
          <section class="lt-sec"><em>01</em><div>${workHtml(x, d)}</div></section>
          <section class="lt-sec"><em>02</em><div>${hitHtml(x, d)}</div></section>
          <section class="lt-sec"><em>03</em><div>${nodeHtml(x, d)}</div></section>
          <section class="lt-sec"><em>04</em><div>${plotHtml(x, d)}</div></section>
          ${routeHtml(x, d)}
          <p class="lt-sign">страница · не тест · ${esc(x.pageUrl())}</p>
        </div>
        ${typeFoot()}
      </div>`;
  }

  function pageMapsheet(x) {
    const d = data(x);
    const bands = x.stepDone(1) ? x.E.mapBands(x.state.answers) : [];
    return `
      <div class="screen no-tabs t-map">
        <div class="map-hero">
          <div class="map-head">
            <span>${esc(x.state.name)}</span>
            <button class="ghost" data-act="share">↑</button>
          </div>
          <div class="map-stripes">
            ${bands.map((b, i) => `<div class="ms ${i < d.lit ? "on" : ""}"><b>${esc(b.name)}</b><span>${i < d.lit ? esc(b.value) : "—"}</span></div>`).join("") || "<p>Карта после трёх вопросов</p>"}
          </div>
        </div>
        <div class="map-sheet">
          <i class="handle"></i>
          <h1>${esc(d.h)}</h1>
          ${nowBox(d)}
          ${workHtml(x, d)}
          ${hitHtml(x, d)}
          ${nodeHtml(x, d)}
          ${plotHtml(x, d)}
          ${routeHtml(x, d)}
          ${typeFoot()}
        </div>
      </div>`;
  }

  function pageAccordion(x) {
    const d = data(x);
    const open = x.state.acc || "now";
    const rows = [
      { id: "now", title: d.now.title, sub: d.now.kicker, html: nowBox(d) },
      { id: "s1", title: "Как ты работаешь", sub: d.s1 ? "открыто" : "3 вопроса", html: workHtml(x, d) },
      { id: "s2", title: "Как задевает", sub: d.s2 ? "открыто" : "ещё 4", html: hitHtml(x, d) },
      { id: "node", title: "Где ты себе мешаешь", sub: d.node ? "узел" : "ступень 3", html: nodeHtml(x, d) },
      { id: "plot", title: "Сюжет", sub: d.syn ? "открыто" : "один вопрос", html: plotHtml(x, d) },
      { id: "route", title: x.stepDone(4) ? "Маршрут" : "Потом", sub: `${d.offer.price} ₽`, html: routeHtml(x, d) },
    ];
    return `
      <div class="screen no-tabs t-acc">
        <header class="acc-top">
          <div>
            <div class="brand">${x.C.brand}</div>
            <strong>${esc(x.state.name)}</strong>
          </div>
          <button class="ghost" data-act="share">↑</button>
        </header>
        <p class="acc-hook">${esc(d.h)}</p>
        <div class="acc-list">
          ${rows.map((r) => `
            <div class="acc-row ${open === r.id ? "open" : ""}">
              <button class="acc-head" data-act="acc-open" data-acc="${r.id}">
                <span>${esc(r.title)}</span>
                <small>${esc(r.sub)}</small>
              </button>
              ${open === r.id ? `<div class="acc-body">${r.html}</div>` : ""}
            </div>`).join("")}
        </div>
        ${typeFoot()}
      </div>`;
  }

  function pageReel(x) {
    const d = data(x);
    const panels = [
      `<section class="reel-p">
        <p class="brand">${x.C.brand} · ${esc(x.state.name)}</p>
        <h1>${esc(d.h)}</h1>
        <p class="hint">свайп вверх — полки страницы</p>
      </section>`,
      `<section class="reel-p">${nowBox(d)}</section>`,
      `<section class="reel-p">${workHtml(x, d)}</section>`,
      `<section class="reel-p">${hitHtml(x, d)}</section>`,
      `<section class="reel-p">${nodeHtml(x, d)}</section>`,
      `<section class="reel-p">${plotHtml(x, d)}</section>`,
      `<section class="reel-p">${routeHtml(x, d)}${typeFoot()}</section>`,
    ];
    return `
      <div class="screen no-tabs t-reel">
        <div class="reel">${panels.join("")}</div>
      </div>`;
  }

  function pageSlides(x) {
    const d = data(x);
    const skin = x.state.skin || "rain";
    const frames = [
      {
        k: "фраза",
        html: `<p class="sl-k">${esc(x.state.name)} · страница</p>
          <h1>${esc(d.h)}</h1>
          <p class="sl-sub">Свайпни влево. Это кусок пути, не кабинет.</p>`,
      },
      {
        k: "сейчас",
        html: `<p class="sl-k">${esc(d.now.kicker)}</p>
          <h1>${esc(d.now.title)}</h1>
          <p>${esc(d.now.why)}</p>
          <p class="hint">${esc(d.now.time || "")}</p>
          ${nowBtn(d.now)}`,
      },
      {
        k: "полка",
        html: d.s1
          ? `<p class="sl-k">уже в кабинете</p><h1>Как ты работаешь</h1><p>${esc(d.s1.paragraphs[0] || "")}</p>`
          : `<p class="sl-k">ещё пусто</p><h1>Как ты работаешь</h1><p>Три вопроса — и этот слайд станет настоящим.</p>${nowBtn(d.now)}`,
      },
      {
        k: "закрыто",
        html: `<p class="sl-k">следующая полка</p>
          <h1>Как тебя задевает</h1>
          <p>${x.stepDone(1) ? "Ещё 4 вопроса — и слайд допишется." : "Сначала первая полка."}</p>
          <p class="hint">590 ₽ на слайдах не живёт.</p>`,
      },
      {
        k: "карта",
        html: `<p class="sl-k">без процентов</p>
          <h1>Как ты устроена</h1>
          <div class="st-stripes">${[0,1,2,3,4,5,6,7].map((i) => `<i class="${i < d.lit ? "on" : ""}"></i>`).join("")}</div>`,
      },
      {
        k: "кабинет",
        html: `<p class="sl-k">дом</p>
          <h1>Открыть кабинет</h1>
          <p>Слайды — путь. Кабинет — куда возвращаешься.</p>
          <button class="btn" data-act="open-cabinet">В кабинет</button>`,
      },
    ];
    const i = Math.max(0, Math.min(x.state.slide || 0, frames.length - 1));
    const skins = SKINS.map((s) => `<button class="sl-skin ${skin === s.id ? "on" : ""}" data-act="set-skin" data-skin="${s.id}">${s.name}</button>`).join("");
    return `
      <div class="screen no-tabs sl-wrap sl-${skin}">
        <div class="st-bars">${frames.map((_, n) => `<i class="${n <= i ? "on" : ""}"></i>`).join("")}</div>
        <div class="sl-stage">
          ${frames[i].html}
        </div>
        <button class="st-hit left" data-act="slide-prev" aria-label="назад"></button>
        <button class="st-hit right" data-act="slide-next" aria-label="дальше"></button>
        <div class="sl-skins">${skins}</div>
        <p class="st-count">${i + 1} / ${frames.length} · ${frames[i].k} · свайп</p>
      </div>`;
  }

  function pageCabinet(x) {
    const d = data(x);
    const rows = [
      { open: !!d.s1, title: "Как ты работаешь", sub: d.s1 ? "открыто" : "3 вопроса", body: d.s1 ? `<p>${esc(d.s1.paragraphs[0] || "")}</p>` : "" },
      { open: !!d.s2, title: "Как задевает", sub: d.s2 ? "открыто" : "ещё 4", body: "" },
      { open: !!d.node, title: "Узел", sub: d.node ? "узел" : "ступень 3", body: "" },
      { open: !!d.syn, title: "Сюжет", sub: d.syn ? "открыто" : "один вопрос", body: "" },
    ];
    return `
      <div class="screen no-tabs cab">
        <header class="cab-top">
          <span>${x.C.brand}</span>
          <button class="ghost" data-act="share">отправить</button>
        </header>
        <p class="cab-url" data-act="copy-url">${esc(x.pageUrl())}</p>
        <p class="cab-name">${esc(x.state.name)}</p>
        <h1 class="cab-hook">${esc(d.h)}</h1>
        <p class="cab-note">Это кабинет. Сюда возвращаешься. Слайды — только куски пути.</p>
        <section class="cab-now">
          <div class="kicker">${esc(d.now.kicker)}</div>
          <h2>${esc(d.now.title)}</h2>
          <p>${esc(d.now.why)}</p>
          ${nowBtn(d.now)}
        </section>
        <div class="cab-shelves">
          ${rows.map((r) => `
            <button class="cab-shelf ${r.open ? "open" : ""}" data-act="start-portion">
              <span>${r.title}</span>
              <small>${r.sub}</small>
              ${r.body}
            </button>`).join("")}
        </div>
        <nav class="type-foot">
          <button data-act="set-type" data-type-set="slides">слайды пути</button>
          <button data-act="tab-map">карта</button>
          <button data-act="tab-more">сменить тип</button>
        </nav>
      </div>`;
  }

  const pages = {
    artifact: pageArtifact,
    stories: pageStories,
    tabs: pageTabs,
    deck: pageDeck,
    letter: pageLetter,
    mapsheet: pageMapsheet,
    accordion: pageAccordion,
    reel: pageReel,
    slides: pageSlides,
    cabinet: pageCabinet,
  };

  function picker(current) {
    return `<div class="type-grid">
      ${TYPES.map((t) => `
        <button type="button" class="type-card ${current === t.id ? "on" : ""}" data-act="set-type" data-type-set="${t.id}">
          <b>${t.name}</b>
          <span>${t.hint}</span>
        </button>`).join("")}
    </div>`;
  }

  global.KO_TYPES = { list: TYPES, pages, picker, skins: SKINS };
})(window);
