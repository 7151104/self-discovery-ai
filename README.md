# AI-самопознание — полный пакет проекта

Многомодельный AI-сервис самопознания для русскоязычной аудитории.  
**Статус:** активная разработка. Концепция и контент готовы; бесплатная лестница работает
кодом — движок координат и кликабельный прототип ступеней 0–4.

```
npm install
npm test        # 84 теста
npm run serve   # прототип на localhost:5173
```

## Для нового агента — начни здесь

1. **Прочитай полностью:** [`AGENT-BOOTSTRAP.md`](./AGENT-BOOTSTRAP.md) — главный документ входа, правила работы, что не ломать.
2. **Пойми, где мы и что дальше:** [`docs/14-state.md`](./docs/14-state.md) → [`docs/13-roadmap.md`](./docs/13-roadmap.md) → [`docs/12-target-state.md`](./docs/12-target-state.md)
3. **Пойми систему:** [`docs/01-architecture.md`](./docs/01-architecture.md) → [`docs/02-coordinates.md`](./docs/02-coordinates.md) → [`docs/04-alignment-rules.md`](./docs/04-alignment-rules.md)
4. **Пойми продукт:** [`docs/05-user-journey.md`](./docs/05-user-journey.md) → [`docs/07-monetization-route.md`](./docs/07-monetization-route.md)
5. **Контент и логика:** папка [`content/`](./content/) + [`prompts/`](./prompts/)
6. **Пример качества:** [`examples/demo-person-answers.md`](./examples/demo-person-answers.md) + [`examples/demo-report-output.md`](./examples/demo-report-output.md)

## Структура репозитория

```
├── AGENT-BOOTSTRAP.md      ← СТАРТ ДЛЯ НОВОГО АГЕНТА
├── README.md               ← этот файл
├── docs/                   ← концепция, архитектура, бизнес
│   ├── 00-vision.md
│   ├── 01-architecture.md
│   ├── 02-coordinates.md
│   ├── 03-models-and-tiers.md
│   ├── 04-alignment-rules.md
│   ├── 05-user-journey.md
│   ├── 06-report-structure.md
│   ├── 07-monetization-route.md
│   ├── 08-legal-safety.md
│   ├── 09-validation.md
│   ├── 10-business-context.md
│   ├── 11-ui-page-spec.md
│   ├── 12-target-state.md  ← что значит «готово на 100%»
│   ├── 13-roadmap.md       ← ЕДИНСТВЕННЫЙ список задач
│   └── 14-state.md         ← где мы сейчас, решения, вопросы
├── content/                ← вопросы, ветви, скоринг (продуктовое ядро)
│   ├── questions-full-bank.md
│   ├── questions-ladder.md
│   ├── scoring-rules.md
│   ├── step0-welcome.md
│   ├── step1-branches.md
│   ├── step2-branches.md
│   ├── step3-contradictions.md
│   ├── step4-open-synthesis.md
│   └── slices/             ← вопросы-доборы платных срезов
├── prompts/                ← промпты для LLM
│   ├── full-report-assembler.md
│   ├── profile-calculator.md
│   └── paid-slice-templates.md
├── examples/               ← демо для калибровки качества
│   ├── demo-person-answers.md
│   └── demo-report-output.md
├── engine/                 ← Rule Engine: контент → координаты → узел → оффер
│   ├── scripts/            ← сборщик content/*.md в типизированные данные
│   └── src/                ← скоринг, узлы, блоки, карта, двери + тесты
├── prototype/              ← кликабельная личная страница на движке
└── tools/serve.mjs         ← статический сервер прототипа
```

Контент правится в markdown, код его только читает: после правки `content/*.md`
достаточно `npm test`, чтобы убедиться, что ничего не разъехалось.

## Ключевые решения (не пересматривать без запроса основателя)

- Модели **не пишут пользователю** — только питают 16 координат
- Дата рождения: **вход и визуал**, ноль выводов о личности
- Бесплатный продукт: **лестница из 4 ступеней**, не один большой тест
- Полный банк 35+3: **добор платной полной карты и ручной прогон**, бесплатного входа на него нет
- Ступени 1–3: **готовые тексты**, не LLM; ступень 4: LLM-синтез
- Первое платное предложение: **одно**, не витрина
- Основатель: **разработчик, не лицо**; виральность через артефакт страницы
- Символические системы: **нулевое право утверждать**

## Следующие задачи разработки

Единственный список задач — [`docs/13-roadmap.md`](./docs/13-roadmap.md). Второго списка
в репозитории нет: конкурирующие перечни расходятся.

- Где мы сейчас: [`docs/14-state.md`](./docs/14-state.md)
- Что делать дальше: [`docs/13-roadmap.md`](./docs/13-roadmap.md)
- Куда идём и что значит «готово»: [`docs/12-target-state.md`](./docs/12-target-state.md)

Закрыты этапы E0 (карта работы) и E1 (ядро бесплатной лестницы: контент, движок,
прототип). В работе E2 — движок до полного контура данных: полный банк 35+3 и доборы всех
восьми срезов разбираются и считаются, пороги генерации и следующие двери работают, дальше
порции доборов, кризисный детектор, несогласие как данные, пересчёт при правке ответа,
добор полной карты из остатка банка.

**Прогон на живых людях — последний этап маршрута (E12)**, после стопроцентной готовности
технической и визуальной части. Условие запуска — раздел «Условие перехода к живым людям»
в `docs/12-target-state.md`.

## История

Исходный Cloud Agent: https://cursor.com/agents/bc-01a07185-8d85-7333-85d2-133106afe504
