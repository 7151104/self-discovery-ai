(function (global) {
  const C = () => global.CONTENT;

  function seasonFromDate(iso) {
    if (!iso) return null;
    const m = Number(String(iso).slice(5, 7));
    if (m >= 3 && m <= 5) return "spring";
    if (m >= 6 && m <= 8) return "summer";
    if (m >= 9 && m <= 11) return "autumn";
    return "winter";
  }

  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }

  function slugify(name) {
    const map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
      з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
      п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
      ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    };
    return String(name || "page")
      .trim()
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? (/[a-z0-9]/.test(ch) ? ch : "-"))
      .join("")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "page";
  }

  function band(n) {
    n = Number(n);
    if (n >= 4) return "high";
    if (n <= 2) return "low";
    return "mid";
  }

  function hook(a) {
    if (a.L2 === "C") return "Ты доводишь до восьмидесяти. Дальше — оценка.";
    if (a.L2 === "A") return "Между «решила» и «сделала» — пропасть.";
    if (a.L2 === "B") return "Первая трудность читается как «не моё».";
    if (a.L2 === "D") return "Ты доводишь. Цена — надрыв в конце.";
    if (a.L2 === "E") return "Риск не в том, что не закончишь.";
    return "Сначала три вопроса. Потом — настоящее.";
  }

  function stitch(a) {
    const key = `${a.L1}|${a.L2}`;
    return C().step1.stitch[key] || "";
  }

  function step1Block(a) {
    const s = C().step1;
    return {
      title: "Как ты работаешь",
      paragraphs: [s.L1[a.L1], s.L2[a.L2], s.L3[a.L3]].filter(Boolean),
      stitch: stitch(a),
    };
  }

  function step2Block(a) {
    const s = C().step2;
    const l6 = band(a.L6);
    const l7 = band(a.L7);
    const price = s.price[`${a.L5}|${l6}`] || "";
    return {
      title: "Как ты обрабатываешь и как тебя задевает",
      paragraphs: [s.L4[a.L4], s.L5[a.L5], s.L6[l6], s.L7[l7]].filter(Boolean),
      price,
    };
  }

  function detectNodes(a) {
    const found = [];
    if (a.L2 === "C" && (a.L8 === "A" || a.L8 === "E")) found.push("NODE_FINISH_FEAR");
    if (Number(a.L9) >= 4 && Number(a.L10) >= 4) found.push("NODE_PLAN_VS_OPEN");
    if (Number(a.L11) >= 4) found.push("NODE_EXTERNAL_DEADLINE");
    if (a.L3 === "A" && Number(a.L6) >= 4) found.push("NODE_OVERLOAD");
    if (a.L4 === "B" && Number(a.L6) >= 4) found.push("NODE_CRITICISM_INTERNAL");
    if (a.L5 === "D" && Number(a.L7) >= 4) found.push("NODE_POTENTIAL_VS_DETAIL");
    return found;
  }

  function dominantNode(a) {
    const ids = detectNodes(a);
    return ids[0] || "NODE_FINISH_FEAR";
  }

  function nodeBlock(a) {
    const id = dominantNode(a);
    const extra = detectNodes(a).filter((x) => x !== id);
    return {
      id,
      extra,
      ...C().nodes[id],
    };
  }

  function synthesis(name, a, node) {
    const quote = String(a.L12 || "").trim();
    const snippet = quote.split(/[.!?]/)[0].trim() || quote;
    return {
      title: "Твой повторяющийся сюжет",
      plot: quote
        ? `Ты сама это назвала: «${snippet}». Круг не в том, что не умеешь. Круг в том, что умение останавливается ровно перед выходом к людям.`
        : "Повторяется одно и то же место: дело почти готово — и не выходит наружу.",
      loop: [
        step1Block(a).paragraphs[0],
        node.text,
        "Круг замыкается так: рывок даёт право считать, что ты в деле. Доработка даёт право не показываться. Пока не показано — ты в безопасности. Поэтому история возвращается.",
      ].filter(Boolean),
      cut: `${name}, я вижу, как замыкается этот круг — но не откуда он пошёл. Не знаю, когда это включилось впервые. Не знаю, что именно ты боишься услышать, если показать в текущем виде. Этого в ответах нет.`,
    };
  }

  function paidReport(name, a, paid) {
    const fear = paid.P8 || "что это несерьёзно";
    return {
      title: "Почему ты останавливаешься у финиша",
      lead: "Пока работа не показана, оценки не существует — а значит, не существует и риска.",
      scene: paid.P1
        ? `Ты уже описывала сцену: ${paid.P1}`
        : "Типичная сцена: пятница, документ в черновиках, «ещё чуть-чуть» — и вечер кончается без отправки.",
      actions: [
        "Назови дату показа до готовности — конкретному человеку.",
        "Поставь недельный потолок часов на своё дело. Остальное не улучшает, а прячет.",
        `Выпиши фразы-объяснения остановки. Рядом вопрос: «что боюсь услышать, если покажу как есть?» Сейчас у тебя это звучит как: ${fear}`,
      ],
      book: "Опора: список фраз, которыми объясняешь остановку. Книга: Роберт Джонсон, «Владеть своей тенью».",
    };
  }

  function mapBands(a) {
    return [
      { name: "Ритм", value: a.L1 === "A" ? "ровный" : a.L1 === "B" ? "импульсы" : a.L1 === "C" ? "спад после старта" : "долгий разгон", tone: 1 },
      { name: "Доведение", value: a.L2 === "C" ? "рвётся на финише" : a.L2 === "A" ? "рвётся на входе" : a.L2 === "B" ? "рвётся на трудности" : "дорогое доведение", tone: 2 },
      { name: "Давление", value: a.L3 === "A" ? "беру всё" : a.L3 === "B" ? "замирание" : "свой сценарий", tone: 3 },
      { name: "Критика", value: a.L4 === "B" ? "молчу и ношу" : a.L4 ? "есть свой ход" : "ещё не сказано", tone: 4 },
      { name: "Новое", value: a.L5 === "D" ? "что вырастет" : a.L5 ? "свой вход" : "ещё не сказано", tone: 5 },
      { name: "Задевание", value: Number(a.L6) >= 4 ? "долго держит" : a.L6 ? "средне" : "ещё не сказано", tone: 0 },
      { name: "Узел", value: C().nodes[dominantNode(a)].title, tone: 2 },
      { name: "Вход в дело", value: Number(a.L11) >= 4 ? "нужен внешний срок" : "свой ход", tone: 6 },
    ];
  }

  global.ENGINE = {
    seasonFromDate,
    formatDate,
    slugify,
    hook,
    stitch,
    step1Block,
    step2Block,
    detectNodes,
    dominantNode,
    nodeBlock,
    synthesis,
    paidReport,
    mapBands,
  };
})(window);