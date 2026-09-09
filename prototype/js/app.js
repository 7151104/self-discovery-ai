(function () {
  const E = window.ENGINE;
  const C = window.CONTENT;
  const root = document.getElementById("app");
  const KEY = "koordinaty-prototype-v1";

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

  function go(screen, extra) {
    Object.assign(state, extra || {}, { screen });
    save();
    render();
  }

  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    root.querySelector(".phone").appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function pageUrl() {
    return `koordinaty.app/${E.slugify(state.name || "page")}`;
  }

  function tabsHtml(active) {
    const badge = nextMissing() && nextMissing() !== "L12" ? `<span class="n">1</span>` : "";
    return `
      <nav class="tabs">
        <button data-act="tab-page" class="${active === "page" ? "on" : ""}">Я</button>
        <button data-act="tab-next" class="${active === "next" ? "on" : ""}">Дальше${badge}</button>
        <button data-act="tab-map" class="${active === "map" ? "on" : ""}">Карта</button>
        <button data-act="tab-more" class="${active === "more" ? "on" : ""}">Ещё</button>
      </nav>`;
  }

  function welcome() {
    return `
      <div class="screen no-tabs">
        <div class="brand">${C.brand}</div>
        <h1>Не тест.<br>Система координат.</h1>
        <p class="lead">Двадцать секунд — и у тебя появится карточка. Без выводов о характере.</p>
        <label>Имя</label>
        <input id="name" value="${escapeAttr(state.name)}" placeholder="Как к тебе обращаться" autocomplete="name">
        <label>Дата рождения <span class="hint">можно пропустить</span></label>
        <input id="date" type="date" value="${escapeAttr(state.date)}">
        <p class="hint">Без даты — без карточки периода. О характере дата всё равно молчит.</p>
        <div class="stack mt">
          <button class="btn" data-act="gift">Получить карточку</button>
          <button class="demo" data-act="demo">Пройти путь Ани — 2 минуты</button>
        </div>
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
        <p>Это входная карточка. Чтобы сказать про тебя что-то настоящее — три вопроса.</p>
        <button class="btn mt" data-act="start-q">Три вопроса — и я скажу, как ты на самом деле работаешь</button>
      </div>`;
  }

  function questionView(qid, pack) {
    const q = pack[qid];
    const ids = Object.keys(pack);
    const idx = ids.indexOf(qid);
    const val = pack === C.questions ? state.answers[qid] : state.paidAnswers[qid];
    const step = q.step || "узел";
    let body = "";
    if (q.kind === "choice") {
      body = q.options.map((o) =>
        `<button class="choice ${val === o.id ? "selected" : ""}" data-act="pick" data-id="${q.id}" data-val="${o.id}">${o.label}</button>`
      ).join("");
    } else if (q.kind === "scale") {
      body = `<div class="scale">${[1, 2, 3, 4, 5].map((n) =>
        `<button class="scale-btn ${Number(val) === n ? "selected" : ""}" data-act="pick" data-id="${q.id}" data-val="${n}">${n}</button>`
      ).join("")}</div>
      <div class="toprow hint"><span>${q.low}</span><span>${q.high}</span></div>`;
    } else {
      body = `<textarea id="open" placeholder="${escapeAttr(q.placeholder || "")}">${escape(val || "")}</textarea>`;
    }
    const pct = Math.round(((idx + (val ? 1 : 0)) / ids.length) * 100);
    return `
      <div class="screen no-tabs">
        <div class="toprow">
          <button class="ghost" data-act="back-q">назад</button>
          <span class="hint">${typeof step === "number" ? `ступень ${step} из 4` : "узел"} · ${idx + 1} / ${ids.length}</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
        <h2>${q.title}</h2>
        ${q.hint ? `<p class="hint">${q.hint}</p>` : ""}
        <div class="stack">${body}</div>
        <button class="btn mt" data-act="next-q" data-id="${q.id}">Дальше</button>
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
          <h1>${h}</h1>
          <p>${st || E.step1Block(state.answers).paragraphs[1] || ""}</p>
          <p class="hint">удержи, если хочешь сохранить. или просто дальше — страница уже твоя.</p>
          <div class="stack" style="margin-top:auto">
            <button class="btn" data-act="after-story">Открыть страницу</button>
            <button class="btn secondary" data-act="share">Отправить не тест — страницу</button>
          </div>
        </div>
      </div>`;
  }

  function page() {
    const h = E.hook(state.answers);
    const s1 = stepDone(1) ? E.step1Block(state.answers) : null;
    const s2 = stepDone(2) ? E.step2Block(state.answers) : null;
    const node = stepDone(3) ? E.nodeBlock(state.answers) : null;
    const syn = stepDone(4) ? E.synthesis(state.name, state.answers, node || E.nodeBlock(state.answers)) : null;
    const next = nextMissing();
    const cta = !stepDone(1)
      ? "Три вопроса — и скажу, как ты работаешь"
      : !stepDone(2)
        ? "Ещё 4 вопроса — скажу, почему так"
        : !stepDone(3)
          ? "Ещё 4 — где ты себе мешаешь"
          : !stepDone(4)
            ? "Один открытый вопрос — соберу сюжет"
            : state.paid
              ? "Открытый разбор уже на странице"
              : `Разобрать узел · ${node.offer.price} ₽`;

    return `
      <div class="screen">
        <div class="toprow">
          <div>
            <div class="brand">${C.brand}</div>
            <div class="serif" style="font-size:28px;margin-top:6px">${escape(state.name)}</div>
            <div class="hint">${pageUrl()}</div>
          </div>
          <button class="icon-btn" data-act="share" aria-label="поделиться">↑</button>
        </div>
        <h1>${stepDone(1) ? h : "Страница уже есть. Настоящее — после трёх вопросов."}</h1>
        ${s1 ? `<article class="card mt"><h2>${s1.title}</h2>${s1.paragraphs.map((p) => `<p>${p}</p>`).join("")}${s1.stitch ? `<p class="lead">${s1.stitch}</p>` : ""}</article>` : ""}
        ${s2 ? `<article class="card mt"><h2>${s2.title}</h2>${s2.paragraphs.map((p) => `<p>${p}</p>`).join("")}${s2.price ? `<p class="lead">${s2.price}</p>` : ""}</article>` : `<button class="door" data-act="tab-next"><span>Как ты обрабатываешь и как тебя задевает</span><span class="lock">${stepDone(1) ? "ещё 4 вопроса" : "закрыто"}</span></button>`}
        ${node ? `<article class="card mt"><h2>Где ты сам себе мешаешь</h2><p class="lead">${node.text}</p><p class="hint">Это узел. Не решение.</p></article>` : `<button class="door" data-act="tab-next"><span>Где ты сам себе мешаешь</span><span class="lock">закрыто</span></button>`}
        ${syn ? `<article class="card mt"><h2>${syn.title}</h2><p class="lead">${syn.plot}</p><p>${syn.cut}</p></article>` : `<button class="door" data-act="tab-next"><span>Сюжет</span><span class="lock">один открытый вопрос</span></button>`}
        ${state.paid ? `<article class="card mt"><h2>Что с этим делать</h2><p class="lead">${E.paidReport(state.name, state.answers, state.paidAnswers).lead}</p><button class="btn secondary" data-act="paid-report">Открыть разбор</button></article>` : ""}
        <div class="mt">
          <p class="hint">Маршрут</p>
          ${offerDoor(node)}
          <button class="door" data-act="toast" data-msg="Срез близости откроется после узла. Не витрина — следующая дверь."><span>Как этот механизм в близких</span><span class="lock">потом</span></button>
          <button class="door" data-act="toast" data-msg="Полная карта — когда координат станет больше."><span>Полная карта</span><span class="lock">потом</span></button>
        </div>
        ${next || !state.paid ? `<button class="btn mt" data-act="${!stepDone(4) ? "tab-next" : "pay"}">${cta}</button>` : `<button class="btn mt" data-act="share">Отправить страницу</button>`}
      </div>
      ${tabsHtml("page")}`;
  }

  function offerDoor(node) {
    const offer = (node && node.offer) || C.nodes.NODE_FINISH_FEAR.offer;
    if (state.paid) {
      return `<button class="door" data-act="paid-report"><span>${offer.title}</span><span class="lock">открыто</span></button>`;
    }
    return `<button class="door" data-act="pay"><span>${offer.title}</span><span class="lock">${offer.price} ₽</span></button>`;
  }

  function mapView() {
    const bands = stepDone(1) ? E.mapBands(state.answers) : [];
    return `
      <div class="screen">
        <div class="brand">${escape(state.name)} · карта</div>
        <h1>Это не тип. Это как ты устроена.</h1>
        <div class="stripes">
          ${bands.map((b) => `<div class="stripe t${b.tone}"><b>${b.name}</b><span>${b.value}</span></div>`).join("") || "<p>Карта появится после первой ступени.</p>"}
        </div>
        <p class="hint">Без процентов. Полосы можно скриншотить.</p>
        <button class="btn secondary" data-act="share">Поделиться картой</button>
      </div>
      ${tabsHtml("map")}`;
  }

  function more() {
    return `
      <div class="screen">
        <h1>Ещё</h1>
        <div class="card">
          <p class="lead">${escape(state.name) || "без имени"}</p>
          <p class="hint">${pageUrl()}</p>
          <div class="stack">
            <button class="btn secondary" data-act="share">Поделиться страницей</button>
            <button class="btn secondary" data-act="toast" data-msg="Вторая получит свою страницу, не гость в твоей. В прототипе это заготовка.">Посмотреть нас двоих</button>
            <button class="btn secondary" data-act="reset">Начать заново</button>
          </div>
        </div>
        <p class="hint mt">Прототип. Тексты ступеней 1–3 — готовые, не нейросеть. Сюжет собран шаблоном.</p>
      </div>
      ${tabsHtml("more")}`;
  }

  function pay() {
    const node = stepDone(3) ? E.nodeBlock(state.answers) : C.nodes.NODE_FINISH_FEAR;
    const syn = stepDone(4) ? E.synthesis(state.name, state.answers, node) : null;
    return `
      <div class="screen">
        <button class="ghost" data-act="tab-page">на страницу</button>
        ${syn ? `<p class="serif lead">«${escape(String(state.answers.L12 || "").split(/[.!?]/)[0])}»</p><p>${syn.cut}</p>` : `<p class="lead">Я вижу узел. Откуда он пошёл — по этим ответам не скажу.</p>`}
        <article class="card mt">
          <h2>${node.offer.title}</h2>
          <p>Чтобы разобрать, где механизм включился и что с ним делать, нужно ещё 8 вопросов про ${node.offer.theme}.</p>
          <div class="price">${node.offer.price} ₽</div>
          <button class="btn" data-act="buy">Разобрать узел</button>
          <p class="hint" style="text-align:center">это не подписка. один разбор.</p>
        </article>
      </div>
      ${tabsHtml("next")}`;
  }

  function paidReport() {
    const r = E.paidReport(state.name, state.answers, state.paidAnswers);
    return `
      <div class="screen">
        <div class="brand">${escape(state.name)} · узел</div>
        <h1>${r.lead}</h1>
        <p>${r.scene}</p>
        <article class="card">
          <h2>Что с этим делать</h2>
          <ol>${r.actions.map((x) => `<li style="margin:0 0 10px">${x}</li>`).join("")}</ol>
          <p class="hint">${r.book}</p>
        </article>
        <button class="btn mt" data-act="share">Этим уже можно делиться</button>
        <button class="btn secondary mt" data-act="tab-page">Вернуться на страницу</button>
      </div>
      ${tabsHtml("page")}`;
  }

  function shareSheet() {
    return `
      <div class="sheet" data-act="close-sheet">
        <div class="inner" data-stop="1">
          <p class="hint">Отправь не тест. Отправь страницу.</p>
          <h2>${E.hook(state.answers)}</h2>
          <p class="hint">${pageUrl()}</p>
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
    let html = "";
    if (state.screen === "welcome") html = welcome();
    else if (state.screen === "gift") html = gift();
    else if (state.screen === "question") html = questionView(state.qid, C.questions);
    else if (state.screen === "story") html = story();
    else if (state.screen === "page") html = page();
    else if (state.screen === "map") html = mapView();
    else if (state.screen === "more") html = more();
    else if (state.screen === "pay") html = pay();
    else if (state.screen === "paid-q") html = questionView(C.paidQuestions[state.paidIndex].id, Object.fromEntries(C.paidQuestions.map((q) => [q.id, q])));
    else if (state.screen === "paid-report") html = paidReport();
    else html = welcome();

    root.innerHTML = `<div class="phone">${html}${state.sheet === "share" ? shareSheet() : ""}</div>`;
  }

  function currentPack() {
    return state.screen === "paid-q" ? C.paidQuestions : null;
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
    if (id === "L12") return go("pay");
    const ids = LADDER;
    const i = ids.indexOf(id);
    go("question", { qid: ids[i + 1] });
  }

  function startPaid() {
    state.paid = true;
    state.paidIndex = 0;
    go("paid-q", { qid: C.paidQuestions[0].id });
  }

  function afterPaid(id) {
    const i = C.paidQuestions.findIndex((q) => q.id === id);
    if (i >= C.paidQuestions.length - 1) return go("paid-report");
    const next = C.paidQuestions[i + 1];
    go("paid-q", { qid: next.id, paidIndex: i + 1 });
  }

  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-act]");
    if (!btn) return;
    if (btn.closest("[data-stop]") && ev.target.closest(".sheet") === btn && btn.classList.contains("sheet")) return;
    const act = btn.dataset.act;
    if (act === "close-sheet") {
      ev.stopPropagation();
      if (btn.classList.contains("sheet") && ev.target !== btn) return;
      state.sheet = null;
      save();
      render();
      return;
    }
    if (btn.closest(".inner") && act === "close-sheet") {
      state.sheet = null; save(); render(); return;
    }

    if (act === "gift") {
      const name = (root.querySelector("#name").value || "").trim();
      const date = root.querySelector("#date").value;
      if (!name) return toast("Напиши имя — хотя бы так, как к тебе обращаются");
      state.name = name;
      state.date = date;
      state.skipDate = !date;
      go("gift");
    } else if (act === "welcome") go("welcome");
    else if (act === "demo") {
      Object.assign(state, {
        name: C.demo.name,
        date: C.demo.date,
        skipDate: false,
        answers: { ...C.demo.answers },
        paidAnswers: {},
        paid: false,
        sheet: null,
      });
      go("story");
    } else if (act === "start-q") go("question", { qid: "L1" });
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
      go("question", { qid: LADDER[i - 1] });
    } else if (act === "after-story") go("page");
    else if (act === "tab-page") go("page");
    else if (act === "tab-map") go("map");
    else if (act === "tab-more") go("more");
    else if (act === "tab-next") {
      const n = nextMissing();
      if (n) go("question", { qid: n });
      else if (!state.paid) go("pay");
      else go("paid-report");
    } else if (act === "pay") go("pay");
    else if (act === "buy") startPaid();
    else if (act === "paid-report") go("paid-report");
    else if (act === "share") {
      state.sheet = "share";
      save();
      render();
    } else if (act === "copy") {
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

  render();
})();