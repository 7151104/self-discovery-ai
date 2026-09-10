(function () {
  const E = window.ENGINE;
  const C = window.CONTENT;
  const root = document.getElementById("app");
  const KEY = "koordinaty-prototype-v1";
  const THEME_KEY = "koordinaty-theme";
  const TYPE_KEY = "koordinaty-type";
  const THEMES = [
    { id: "slate", name: "Сланец", hint: "холодный серый, вишня", swatch: "#c43b4b" },
    { id: "graphite", name: "Графит", hint: "тёмная, лёд", swatch: "#7aa2ff" },
    { id: "forest", name: "Лес", hint: "туман и зелень", swatch: "#2f6b4f" },
    { id: "violet", name: "Чернила", hint: "белый и фиолет", swatch: "#6b4ce6" },
    { id: "ocean", name: "Океан", hint: "серо-голубой и бирюза", swatch: "#1f6b6b" },
    { id: "marsala", name: "Марсала", hint: "камень и вино, без жёлтого", swatch: "#8b3a4a" },
  ];
  const STEPS = {
    1: { name: "Как работаешь", long: "Как ты работаешь", get: "блок «Как ты работаешь» и фраза на страницу", n: 3, min: 2 },
    2: { name: "Как задевает", long: "Как обрабатываешь и как тебя задевает", get: "как ты обрабатываешь и чем это тебе стоит", n: 4, min: 2 },
    3: { name: "Узел", long: "Где ты себе мешаешь", get: "один узел. Без совета", n: 4, min: 2 },
    4: { name: "Сюжет", long: "Сюжет", get: "сюжет твоими словами и обрыв", n: 1, min: 3 },
  };

  function typeId() {
    const t = localStorage.getItem(TYPE_KEY);
    return (window.KO_TYPES.list || []).some((x) => x.id === t) ? t : "artifact";
  }
  function theme() {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.some((x) => x.id === t) ? t : "slate";
  }
  function applyTheme() {
    const t = theme();
    const typ = typeId();
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.type = typ;
    document.body.dataset.theme = t;
    document.body.dataset.type = typ;
  }

  const LADDER = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12"];

  const state = load() || {
    name: "",
    date: "",
    skipDate: false,
    answers: {},
    paidAnswers: {},
    paid: false,
    screen: "welcome",
    qid: "L1",
    paidIndex: 0,
    seenCoach: false,
    slide: 0,
    card: 0,
    acc: "now",
  };

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || ""); } catch { return null; }
  }

  function answeredCount() {
    return LADDER.filter((id) => state.answers[id] !== undefined && state.answers[id] !== "").length;
  }
  function nextMissing() {
    return LADDER.find((id) => state.answers[id] === undefined || state.answers[id] === "");
  }
  function stepDone(n) {
    const ids = LADDER.filter((id) => C.questions[id].step === n);
    return ids.every((id) => state.answers[id] !== undefined && state.answers[id] !== "");
  }
  function currentStepNum() {
    if (!stepDone(1)) return 1;
    if (!stepDone(2)) return 2;
    if (!stepDone(3)) return 3;
    if (!stepDone(4)) return 4;
    return 5;
  }
  function freeMinutesLeft() {
    return { 1: 8, 2: 6, 3: 4, 4: 3, 5: 0 }[currentStepNum()] || 0;
  }
  function mapLitCount() {
    if (stepDone(3) || stepDone(4)) return 8;
    if (stepDone(2)) return 6;
    if (stepDone(1)) return 3;
    return 0;
  }

  function go(screen, extra) {
    Object.assign(state, extra || {}, { screen });
    save();
    render();
  }

  function toast(text) {
    const phone = root.querySelector(".phone");
    if (!phone) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = text;
    phone.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function pageUrl() {
    return `koordinaty.app/${E.slugify(state.name || "page")}`;
  }

  function chromeNav(active) {
    if (typeId() === "tabs") return tabsHtml(active);
    return `<nav class="type-foot">
      <button data-act="tab-page">страница</button>
      <button data-act="tab-next">дальше</button>
      <button data-act="tab-map">карта</button>
      <button data-act="tab-more">тип</button>
    </nav>`;
  }

  function tabsHtml(active) {
    const waiting = Boolean(nextMissing());
    const badge = waiting ? `<span class="n">1</span>` : "";
    return `
      <nav class="tabs" aria-label="Разделы">
        <button data-act="tab-page" class="${active === "page" ? "on" : ""}" aria-current="${active === "page" ? "page" : "false"}">Я</button>
        <button data-act="tab-next" class="${active === "next" ? "on" : ""}" aria-current="${active === "next" ? "page" : "false"}">Дальше${badge}</button>
        <button data-act="tab-map" class="${active === "map" ? "on" : ""}" aria-current="${active === "map" ? "page" : "false"}">Карта</button>
        <button data-act="tab-more" class="${active === "more" ? "on" : ""}" aria-current="${active === "more" ? "page" : "false"}">Ещё</button>
      </nav>`;
  }

  function welcome() {
    return `
      <div class="screen no-tabs">
        <div class="brand">${C.brand}</div>
        <h1>Твоя страница.<br>Не тест.</h1>
        <p class="lead">Сначала выбери, как ходить. Это разные системы, не разные цвета.</p>
        ${window.KO_TYPES.picker(typeId())}
        <p class="lead">Двадцать секунд — имя. Потом порции по 3–4 вопроса.</p>
        <div class="benefits">
          <div>1. Сначала подарок — ещё ничего не спрашиваем</div>
          <div>2. Каждая порция сразу что-то открывает на странице</div>
          <div>3. Деньги — один раз, после сюжета. Не подписка</div>
        </div>
        <label for="name">Как к тебе обращаться</label>
        <input id="name" value="${escapeAttr(state.name)}" placeholder="Имя" autocomplete="given-name" maxlength="40">
        <label for="date">Дата рождения <span class="hint">можно пропустить</span></label>
        <input id="date" type="date" value="${escapeAttr(state.date)}">
        <p class="hint">Без даты — без карточки периода. О характере дата всё равно молчит.</p>
        <div class="stack mt">
          <button class="btn" data-act="gift">Получить карточку</button>
          <button class="demo" data-act="gift-skip">без даты — только имя</button>
          <button class="demo" data-act="demo">Посмотреть, как это выглядит у Ани</button>
        </div>
        <p class="hint">Всего 6–8 минут бесплатно. Сейчас — двадцать секунд.</p>
      </div>`;
  }

  function gift() {
    const season = state.skipDate ? null : E.seasonFromDate(state.date);
    const period = season ? C.periods[season] : null;
    return `
      <div class="screen no-tabs">
        <div class="toprow"><span class="brand">${C.brand}</span><button class="ghost" data-act="welcome">изменить</button></div>
        <h1>${escape(state.name)}</h1>
        ${period ? `<p class="lead serif">сейчас у тебя период ${period.title}.</p><p>${period.text}</p>` : `<p class="lead">Карточка периода появится, если вернёшь дату. Это только метафора сезона.</p>`}
        ${state.date && !state.skipDate ? `<p class="hint">${E.formatDate(state.date)}</p>` : ""}
        <p class="why">Это входная карточка, не характер. Настоящее — после трёх вопросов: блок «Как ты работаешь» и фраза на страницу.</p>
        <div class="skel" aria-hidden="true"><i class="on"></i><i></i><i></i></div>
        <p class="hint">Так будет страница: одна открытая полка, остальные — после следующих порций. Не двенадцать вопросов сразу.</p>
        <button class="btn mt" data-act="start-q">Три вопроса — и откроется первая полка</button>
      </div>`;
  }

  function questionView(qid, pack) {
    const q = pack[qid];
    const portion = Object.keys(pack).filter((id) => !q.step || pack[id].step === q.step);
    const ids = portion.length ? portion : Object.keys(pack);
    const idx = Math.max(0, ids.indexOf(qid));
    const val = pack === C.questions ? state.answers[qid] : state.paidAnswers[qid];
    const why = {
      1: "Это порция, не весь путь. После неё на странице появится блок «Как ты работаешь».",
      2: "После этой порции — как ты обрабатываешь и чем это тебе стоит.",
      3: "После этой порции — один узел. Без совета.",
      4: "После этого соберу сюжет твоими словами.",
    }[q.step] || "Новые ответы нужны, чтобы разобрать узел. Не пересказ старого.";
    const stepName = STEPS[q.step]?.name || "Узел вглубь";
    let body = "";
    if (q.kind === "choice") {
      body = q.options.map((o) =>
        `<button class="choice ${val === o.id ? "selected" : ""}" data-act="pick" data-id="${q.id}" data-val="${o.id}"><span class="ltr">${o.id}</span><span>${escape(o.label)}</span></button>`
      ).join("");
    } else if (q.kind === "scale") {
      body = `<div class="scale">${[1, 2, 3, 4, 5].map((n) =>
        `<button class="scale-btn ${Number(val) === n ? "selected" : ""}" data-act="pick" data-id="${q.id}" data-val="${n}">${n}</button>`
      ).join("")}</div>
      <div class="toprow hint"><span>${escape(q.low || "")}</span><span>${escape(q.high || "")}</span></div>`;
    } else {
      body = `<textarea id="open" placeholder="${escapeAttr(q.placeholder || "")}">${escape(val || "")}</textarea>`;
    }
    const answeredHere = val !== undefined && val !== "";
    const pct = Math.round(((idx + (answeredHere ? 1 : 0)) / ids.length) * 100);
    return `
      <div class="screen no-tabs">
        <div class="toprow">
          <button class="ghost" data-act="back-q">назад</button>
          <span class="hint">${stepName} · ${idx + 1} из ${ids.length}</span>
          ${stepDone(1) && state.screen !== "paid-q" ? `<button class="ghost" data-act="tab-page">к странице</button>` : ""}
        </div>
        <div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <p class="why">${why}</p>
        <h2>${escape(q.title)}</h2>
        ${q.hint ? `<p class="hint">${escape(q.hint)}</p>` : ""}
        <div class="stack">${body}</div>
        <div class="qfoot">
          <button class="btn" data-act="next-q" data-id="${q.id}" ${answeredHere ? "" : "disabled"}>${answeredHere ? "Дальше" : "Сначала выбери ответ"}</button>
        </div>
      </div>`;
  }

  function story() {
    const h = E.hook(state.answers);
    const st = E.stitch(state.answers);
    return `
      <div class="screen no-tabs">
        <div class="story">
          <div class="bars"><i class="on"></i><i></i><i></i></div>
          <div class="brand">ступень 1 · ${escape(state.name)}</div>
          <h1>${escape(h)}</h1>
          <p>${escape(st || (E.step1Block(state.answers).paragraphs[1] || ""))}</p>
          <p class="hint">Это уже можно отправить. Не «пройди тест» — страницу.</p>
          <div class="stack" style="margin-top:auto">
            <button class="btn" data-act="after-story">Открыть страницу</button>
            <button class="btn secondary" data-act="share">Отправить страницу</button>
          </div>
        </div>
      </div>`;
  }

  function nowCard() {
    const node = stepDone(3) ? E.nodeBlock(state.answers) : C.nodes.NODE_FINISH_FEAR;
    if (!stepDone(1)) {
      return { kicker: "Сейчас", title: "Три вопроса", why: "После них на странице появится блок «Как ты работаешь» и фраза, которой можно поделиться.", time: "~2 минуты · бесплатно", cta: "Начать", act: "start-portion" };
    }
    if (!stepDone(2)) {
      return { kicker: "Сейчас", title: "Ещё 4 вопроса", why: "Потом появится блок: как ты обрабатываешь и как тебя задевает.", time: "~2 минуты · бесплатно", cta: "Продолжить", act: "start-portion" };
    }
    if (!stepDone(3)) {
      return { kicker: "Сейчас", title: "Ещё 4 вопроса", why: "Потом — один узел: где ты себе мешаешь. Без совета.", time: "~2 минуты · бесплатно", cta: "Продолжить", act: "start-portion" };
    }
    if (!stepDone(4)) {
      return { kicker: "Сейчас", title: "Один открытый вопрос", why: "Соберу сюжет твоими словами. Дальше без новых ответов не скажу.", time: "~3 минуты · бесплатно", cta: "Написать", act: "start-portion" };
    }
    if (!state.paid) {
      return { kicker: "Дальше вглубь", title: node.offer.title, why: `Я вижу узел. Откуда он — по этим ответам не скажу. Нужно 8 вопросов про ${node.offer.theme}.`, time: `${node.offer.price} ₽ · не подписка`, cta: `Разобрать узел · ${node.offer.price} ₽`, act: "pay" };
    }
    return { kicker: "Страница живая", title: "Разбор узла уже твой", why: "Можно вернуться к тексту или отправить страницу — не тест.", time: "", cta: "Открыть разбор", act: "paid-report" };
  }

  function pillsHtml() {
    const items = [
      { n: 1, label: "Как работаешь" },
      { n: 2, label: "Как задевает" },
      { n: 3, label: "Узел" },
      { n: 4, label: "Сюжет" },
    ];
    const current = currentStepNum();
    return `<div class="pills" aria-label="Лестница">${items.map((it) => {
      const cls = stepDone(it.n) ? "done" : current === it.n ? "cur" : "";
      return `<span class="${cls}">${stepDone(it.n) ? "✓ " : ""}${it.label}</span>`;
    }).join("")}</div>`;
  }

  function coachHtml() {
    if (state.seenCoach || !stepDone(1)) return "";
    return `
      <article class="coach">
        <p class="kicker-line">Как это читать</p>
        <ol>
          <li>Это уже твоя страница — не результат теста.</li>
          <li>Делай одно: карточку «Сейчас».</li>
          <li>590 ₽ появится после сюжета. Не подписка.</li>
        </ol>
        <button class="btn secondary" data-act="dismiss-coach">Понятно</button>
      </article>`;
  }

  function youAreHtml() {
    const n = currentStepNum();
    if (n <= 4) {
      return `<div class="you-are">Сейчас: ${STEPS[n].name.toLowerCase()} · ещё ~${freeMinutesLeft()} мин бесплатно</div>`;
    }
    return `<div class="you-are">${state.paid ? "Страница собрана. Разбор узла открыт." : "Бесплатное собрано. Дальше — если захочешь."}</div>`;
  }

  function typeApi() {
    return {
      E, C, state, STEPS, escape, nowCard, pillsHtml, offerDoor, tabsHtml,
      youAreHtml, coachHtml, stepDone, currentStepNum, mapLitCount, pageUrl,
      freeMinutesLeft, pageTabs: pageTabsImpl,
    };
  }

  function page() {
    const fn = window.KO_TYPES.pages[typeId()];
    return fn ? fn(typeApi()) : pageTabsImpl();
  }

  function pageTabsImpl() {
    const h = E.hook(state.answers);
    const s1 = stepDone(1) ? E.step1Block(state.answers) : null;
    const s2 = stepDone(2) ? E.step2Block(state.answers) : null;
    const node = stepDone(3) ? E.nodeBlock(state.answers) : null;
    const syn = stepDone(4) ? E.synthesis(state.name, state.answers, node || E.nodeBlock(state.answers)) : null;
    const now = nowCard();
    const lit = mapLitCount();

    return `
      <div class="screen">
        <div class="toprow">
          <div>
            <div class="brand">${C.brand}</div>
            <div class="serif name-xl">${escape(state.name)}</div>
            <div class="hint"><button class="url-btn" data-act="copy-url">${escape(pageUrl())}</button> · твоя страница</div>
            ${youAreHtml()}
          </div>
          <button class="icon-btn" data-act="share" aria-label="поделиться">↑</button>
        </div>
        <h1>${stepDone(1) ? escape(h) : "Страница уже твоя. Настоящее — после трёх вопросов."}</h1>
        ${coachHtml()}
        <section class="now">
          <div class="kicker">${now.kicker}</div>
          <h2>${escape(now.title)}</h2>
          <p>${escape(now.why)}</p>
          ${now.time ? `<p class="hint">${escape(now.time)}</p>` : ""}
          <button class="btn" data-act="${now.act}">${escape(now.cta)}</button>
        </section>
        ${pillsHtml()}
        <div class="mini-map" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<i class="${i < lit ? "on" : ""}"></i>`).join("")}</div>
        <p class="section-label">Уже на странице</p>
        ${s1 ? `<article class="card"><h2>${escape(s1.title)}</h2>${s1.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("")}${s1.stitch ? `<p class="lead">${escape(s1.stitch)}</p>` : ""}</article>` : `<button class="door" data-act="start-portion"><span>Как ты работаешь</span><span class="lock">3 вопроса</span></button>`}
        ${s2 ? `<article class="card mt"><h2>${escape(s2.title)}</h2>${s2.paragraphs.map((p) => `<p>${escape(p)}</p>`).join("")}${s2.price ? `<p class="lead">${escape(s2.price)}</p>` : ""}</article>` : `<button class="door" data-act="start-portion"><span>Как обрабатываешь и как тебя задевает</span><span class="lock">${stepDone(1) ? "ещё 4 вопроса" : "после первой ступени"}</span></button>`}
        ${node ? `<article class="card mt"><h2>Где ты себе мешаешь</h2><p class="lead">${escape(node.text)}</p><p class="hint">Это узел. Не решение.</p></article>` : `<button class="door" data-act="start-portion"><span>Где ты себе мешаешь</span><span class="lock">${stepDone(2) ? "ещё 4 вопроса" : "ступень 3"}</span></button>`}
        ${syn ? `<article class="card mt"><h2>${escape(syn.title)}</h2><p class="lead">${escape(syn.plot)}</p><p>${escape(syn.cut)}</p></article>` : `<button class="door" data-act="start-portion"><span>Сюжет</span><span class="lock">один открытый вопрос</span></button>`}
        ${state.paid ? `<article class="card mt"><h2>Что с этим делать</h2><p class="lead">${escape(E.paidReport(state.name, state.answers, state.paidAnswers).lead)}</p><button class="btn secondary" data-act="paid-report">Открыть разбор</button></article>` : ""}
        <div class="mt ${stepDone(4) ? "" : "quiet"}">
          <p class="section-label">${stepDone(4) ? "Маршрут" : "Потом, если захочешь"}</p>
          ${offerDoor(node)}
          <button class="door" data-act="toast" data-msg="Срез близости — следующая дверь после узла. Не витрина."><span>Как этот механизм в близких</span><span class="lock">потом</span></button>
          <button class="door" data-act="toast" data-msg="Полная карта — когда координат станет больше."><span>Полная карта</span><span class="lock">потом</span></button>
        </div>
      </div>
      ${tabsHtml("page")}`;
  }

  function offerDoor(node) {
    const offer = (node && node.offer) || C.nodes.NODE_FINISH_FEAR.offer;
    if (state.paid) {
      return `<button class="door" data-act="paid-report"><span>${escape(offer.title)}</span><span class="lock">открыто</span></button>`;
    }
    return `<button class="door" data-act="pay"><span>${escape(offer.title)}</span><span class="lock">${offer.price} ₽</span></button>`;
  }

  function nextView() {
    const now = nowCard();
    const cur = currentStepNum();
    const track = [1, 2, 3, 4].map((n) => {
      const s = STEPS[n];
      const cls = stepDone(n) ? "done" : cur === n ? "cur" : "";
      const right = stepDone(n) ? "открыто" : n === cur ? `${s.n} вопр. · ~${s.min} мин` : "потом";
      return `<div class="track-row ${cls}"><b>${s.name}</b><span>${right}</span></div>`;
    }).join("");
    const payBits = cur > 4 && !state.paid
      ? `<ul class="get-list">
          <li>Как ты принимаешь решения — по новым ответам, не по типу</li>
          <li>Где ломается — узлы, не советы</li>
          <li>С кем сходишься и где трёт — без гороскопа</li>
          <li>Что делать дальше — маршрут, не аффирмация</li>
        </ul>`
      : "";
    return `
      <div class="screen">
        <p class="kicker-line">Куда дальше</p>
        <h1>${escape(now.title)}</h1>
        <p class="lead">${escape(now.why)}</p>
        ${now.time ? `<p class="hint">${escape(now.time)}</p>` : ""}
        <div class="card mt">${track}</div>
        ${cur <= 4 ? `<p class="why">После этой порции на странице появится: ${STEPS[cur].get}.</p>` : payBits}
        <button class="btn mt" data-act="${now.act}">${escape(now.cta)}</button>
        ${cur <= 4 ? `<p class="hint">590 ₽ — потом, если захочешь. Сейчас бесплатно.</p>` : ""}
      </div>
      ${chromeNav("next")}`;
  }

  function mapView() {
    const bands = stepDone(1) ? E.mapBands(state.answers) : [];
    const lit = mapLitCount();
    return `
      <div class="screen">
        <div class="brand">${escape(state.name)} · карта</div>
        <h1>Это не тип. Это как ты устроена.</h1>
        <p class="hint">Без процентов. Полосы можно скриншотить. Неоткрытое — серое, не выдуманное.</p>
        <div class="stripes">
          ${bands.map((b, i) => `<div class="stripe t${b.tone} ${i >= lit ? "locked" : ""}"><b>${escape(b.name)}</b><span>${i >= lit ? "ещё не сказано" : escape(b.value)}</span></div>`).join("") || "<p>Карта появится после первой ступени. Три вопроса — и первые полосы.</p>"}
        </div>
        <button class="btn secondary" data-act="share">Поделиться картой</button>
      </div>
      ${chromeNav("map")}`;
  }

  function more() {
    const t = theme();
    const swatches = THEMES.map(
      (x) =>
        `<button type="button" class="${t === x.id ? "on" : ""}" data-act="set-theme" data-theme-set="${x.id}">
          <i style="background:${x.swatch}"></i>
          <span>${x.name}<small>${x.hint}</small></span>
        </button>`
    ).join("");
    return `
      <div class="screen">
        <h1>Ещё</h1>
        <div class="card">
          <p class="kicker-line">Тип</p>
          <h2>Как ходить</h2>
          <p class="lead">Разный жест и характер. Не перекраска.</p>
          ${window.KO_TYPES.picker(typeId())}
        </div>
        <div class="card mt">
          <p class="kicker-line">Цвет</p>
          <h2>Как смотреть</h2>
          <p class="lead">Один смысл. Шесть спокойных палитр. Жёлтого нет.</p>
          <div class="themes">${swatches}</div>
        </div>
        <div class="card mt">
          <p class="lead">${escape(state.name) || "без имени"}</p>
          <p class="hint">${escape(pageUrl())} · ${currentStepNum() <= 4 ? `ступень ${Math.min(currentStepNum(), 4)} из 4` : "лестница собрана"} · ${answeredCount()} ответа</p>
          <div class="stack">
            <button class="btn secondary" data-act="share">Поделиться страницей</button>
            <button class="btn secondary" data-act="toast" data-msg="Вторая получит свою страницу, не гость в твоей. В прототипе это заготовка.">Посмотреть нас двоих</button>
            <button class="btn secondary" data-act="reset">Начать заново</button>
          </div>
        </div>
        <p class="hint mt">Прототип. Ступени 1–3 — готовые тексты. Сюжет собран шаблоном. Цвет сохранится, если начнёшь заново.</p>
      </div>
      ${chromeNav("more")}`;
  }

  function pay() {
    const node = stepDone(3) ? E.nodeBlock(state.answers) : C.nodes.NODE_FINISH_FEAR;
    const syn = stepDone(4) ? E.synthesis(state.name, state.answers, node) : null;
    const ready = stepDone(4);
    return `
      <div class="screen">
        <button class="ghost" data-act="tab-page">на страницу</button>
        ${syn ? `<p class="serif lead">«${escape(String(state.answers.L12 || "").split(/[.!?]/)[0])}»</p><p>${escape(syn.cut)}</p>` : `<p class="lead">Я вижу направление узла. Откуда он пошёл — по этим ответам не скажу.</p>`}
        <article class="card mt">
          <h2>${escape(node.offer.title)}</h2>
          <p>Чтобы разобрать, где механизм включился и что с ним делать, нужно ещё 8 вопросов про ${escape(node.offer.theme)}.</p>
          <ul class="get-list">
            <li>Как ты принимаешь решения — по новым ответам, не по типу</li>
            <li>Где ломается — узлы, не советы</li>
            <li>С кем сходишься и где трёт — без гороскопа</li>
            <li>Что делать дальше — маршрут, не аффирмация</li>
          </ul>
          <div class="price">${node.offer.price} ₽</div>
          ${ready
            ? `<button class="btn" data-act="buy">Разобрать узел</button>`
            : `<p class="why">Сначала дочитай бесплатное. Кнопка оплаты появится после сюжета.</p><button class="btn" data-act="start-portion">Вернуться к бесплатному</button>`}
          <p class="hint" style="text-align:center">это не подписка. один разбор.</p>
        </article>
      </div>
      ${chromeNav("next")}`;
  }

  function paidReport() {
    const r = E.paidReport(state.name, state.answers, state.paidAnswers);
    return `
      <div class="screen">
        <div class="brand">${escape(state.name)} · узел</div>
        <h1>${escape(r.lead)}</h1>
        <p>${escape(r.scene)}</p>
        <article class="card">
          <h2>Что с этим делать</h2>
          <ol>${r.actions.map((x) => `<li style="margin:0 0 10px">${escape(x)}</li>`).join("")}</ol>
          <p class="hint">${escape(r.book)}</p>
        </article>
        <button class="btn mt" data-act="share">Этим уже можно делиться</button>
        <button class="btn secondary mt" data-act="tab-page">Вернуться на страницу</button>
      </div>
      ${chromeNav("page")}`;
  }

  function shareSheet() {
    return `
      <div class="sheet" data-act="close-sheet">
        <div class="inner" data-stop="1">
          <p class="hint">Отправь не тест. Отправь страницу.</p>
          <h2>${escape(E.hook(state.answers))}</h2>
          <p class="hint">${escape(pageUrl())}</p>
          <div class="stack">
            <button class="btn" data-act="copy">Скопировать ссылку</button>
            <button class="btn secondary" data-act="native-share">Сторис / сообщение</button>
            <button class="ghost" data-act="close-sheet">закрыть</button>
          </div>
        </div>
      </div>`;
  }

  function escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function escapeAttr(s) { return escape(s); }

  function render() {
    applyTheme();
    let html = "";
    if (state.screen === "welcome") html = welcome();
    else if (state.screen === "gift") html = gift();
    else if (state.screen === "question") html = questionView(state.qid, C.questions);
    else if (state.screen === "story") html = story();
    else if (state.screen === "page") html = page();
    else if (state.screen === "next") html = nextView();
    else if (state.screen === "map") html = mapView();
    else if (state.screen === "more") html = more();
    else if (state.screen === "pay") html = pay();
    else if (state.screen === "paid-q") html = questionView(C.paidQuestions[state.paidIndex].id, Object.fromEntries(C.paidQuestions.map((q) => [q.id, q])));
    else if (state.screen === "paid-report") html = paidReport();
    else html = welcome();

    root.innerHTML = `<div class="phone" data-theme="${theme()}" data-type="${typeId()}">${html}${state.sheet === "share" ? shareSheet() : ""}</div>`;
  }

  function readOpen() {
    const t = root.querySelector("#open");
    if (t) {
      if (state.screen === "paid-q") state.paidAnswers[state.qid] = t.value.trim();
      else state.answers[state.qid] = t.value.trim();
    }
  }

  function afterAnswer(id) {
    if (id === "L3") return go("story");
    if (id === "L7" || id === "L11") return go("page");
    if (id === "L12") return go("page");
    const ids = LADDER;
    const i = ids.indexOf(id);
    go("question", { qid: ids[i + 1] });
  }

  function startPaid() {
    if (!stepDone(4)) {
      toast("Сначала дочитай бесплатное — сюжет");
      return go("next");
    }
    state.paid = true;
    state.paidIndex = 0;
    go("paid-q", { qid: C.paidQuestions[0].id });
  }

  function startPortion() {
    const n = nextMissing();
    if (n) return go("question", { qid: n });
    if (!state.paid) return go("pay");
    return go("paid-report");
  }

  function afterPaid(id) {
    const i = C.paidQuestions.findIndex((q) => q.id === id);
    if (i >= C.paidQuestions.length - 1) return go("paid-report");
    const next = C.paidQuestions[i + 1];
    go("paid-q", { qid: next.id, paidIndex: i + 1 });
  }

  function takeNameDate(skipDate) {
    const nameEl = root.querySelector("#name");
    const dateEl = root.querySelector("#date");
    const name = ((nameEl && nameEl.value) || state.name || "").trim();
    const date = dateEl ? dateEl.value : state.date;
    if (!name) return toast("Напиши имя — хотя бы так, как к тебе обращаются");
    state.name = name;
    state.date = skipDate ? "" : date;
    state.skipDate = Boolean(skipDate || !state.date);
    go("gift");
  }

  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close-sheet") {
      ev.stopPropagation();
      if (btn.classList.contains("sheet") && ev.target !== btn) return;
      state.sheet = null;
      save();
      render();
      return;
    }

    if (act === "gift") takeNameDate(false);
    else if (act === "gift-skip") takeNameDate(true);
    else if (act === "welcome") go("welcome");
    else if (act === "demo") {
      Object.assign(state, {
        name: C.demo.name,
        date: C.demo.date,
        skipDate: false,
        answers: {
          L1: C.demo.answers.L1,
          L2: C.demo.answers.L2,
          L3: C.demo.answers.L3,
        },
        paidAnswers: {},
        paid: false,
        sheet: null,
        seenCoach: true,
        slide: 0,
        card: 0,
        acc: "now",
      });
      go("page");
    } else if (act === "start-q" || act === "start-portion") startPortion();
    else if (act === "pick") {
      if (state.screen === "paid-q") state.paidAnswers[btn.dataset.id] = isNaN(btn.dataset.val) ? btn.dataset.val : Number(btn.dataset.val);
      else state.answers[btn.dataset.id] = isNaN(btn.dataset.val) ? btn.dataset.val : Number(btn.dataset.val);
      save();
      render();
    } else if (act === "next-q") {
      readOpen();
      const id = btn.dataset.id;
      const val = state.screen === "paid-q" ? state.paidAnswers[id] : state.answers[id];
      if (val === undefined || val === "") return toast("Выбери ответ — иначе нечего сказать");
      save();
      if (state.screen === "paid-q") afterPaid(id);
      else afterAnswer(id);
    } else if (act === "back-q") {
      readOpen();
      if (state.screen === "paid-q") {
        const i = C.paidQuestions.findIndex((q) => q.id === state.qid);
        if (i <= 0) return go("pay");
        const prev = C.paidQuestions[i - 1];
        return go("paid-q", { qid: prev.id, paidIndex: i - 1 });
      }
      const i = LADDER.indexOf(state.qid);
      if (i <= 0) return go("gift");
      const prev = LADDER[i - 1];
      const curStep = C.questions[state.qid].step;
      const prevStep = C.questions[prev].step;
      if (prevStep !== curStep && stepDone(1)) return go("page");
      go("question", { qid: prev });
    } else if (act === "after-story") go("page");
    else if (act === "tab-page") go("page");
    else if (act === "tab-map") go("map");
    else if (act === "tab-more") go("more");
    else if (act === "tab-next") go("next");
    else if (act === "pay") go("pay");
    else if (act === "buy") startPaid();
    else if (act === "paid-report") go("paid-report");
    else if (act === "dismiss-coach") {
      state.seenCoach = true;
      save();
      render();
    } else if (act === "set-type") {
      const id = btn.dataset.typeSet;
      localStorage.setItem(TYPE_KEY, id);
      const meta = window.KO_TYPES.list.find((t) => t.id === id);
      if (meta) localStorage.setItem(THEME_KEY, meta.theme);
      state.slide = 0;
      state.card = 0;
      state.acc = "now";
      if (state.screen !== "welcome") go("page");
      else render();
    } else if (act === "slide-next") {
      state.slide = (state.slide || 0) + 1;
      save();
      render();
    } else if (act === "slide-prev") {
      state.slide = Math.max(0, (state.slide || 0) - 1);
      save();
      render();
    } else if (act === "deck-next") {
      state.card = (state.card || 0) + 1;
      save();
      render();
    } else if (act === "deck-prev") {
      state.card = Math.max(0, (state.card || 0) - 1);
      save();
      render();
    } else if (act === "acc-open") {
      state.acc = btn.dataset.acc;
      save();
      render();
    } else if (act === "set-theme") {
      localStorage.setItem(THEME_KEY, btn.dataset.themeSet);
      render();
    } else if (act === "share") {
      state.sheet = "share";
      save();
      render();
    } else if (act === "copy" || act === "copy-url") {
      const url = `https://${pageUrl()}`;
      try { await navigator.clipboard.writeText(url); } catch {}
      toast("Ссылка скопирована. Это страница, не тест.");
    } else if (act === "native-share") {
      const url = `https://${pageUrl()}`;
      if (navigator.share) {
        try { await navigator.share({ title: state.name, text: E.hook(state.answers), url }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(`${E.hook(state.answers)} ${url}`); } catch {}
        toast("Текст для сторис скопирован");
      }
    } else if (act === "toast") toast(btn.dataset.msg);
    else if (act === "reset") {
      localStorage.removeItem(KEY);
      location.reload();
    }
  });

  root.addEventListener("click", (ev) => {
    if (ev.target.classList.contains("sheet")) {
      state.sheet = null;
      save();
      render();
    }
  });

  applyTheme();
  render();
})();
