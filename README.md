# AI-самопознание — полный пакет проекта

Многомодельный AI-сервис самопознания для русскоязычной аудитории.  
**Статус:** активная разработка. Концепция и контент готовы; бесплатная лестница работает
кодом — движок координат и кликабельный прототип ступеней 0–4.

```
npm install
npm test        # 30 тестов
npm run serve   # прототип на localhost:5173
```

## Для нового агента — начни здесь

1. **Прочитай полностью:** [`AGENT-BOOTSTRAP.md`](./AGENT-BOOTSTRAP.md) — главный документ входа, правила работы, что не ломать.
2. **Пойми систему:** [`docs/01-architecture.md`](./docs/01-architecture.md) → [`docs/02-coordinates.md`](./docs/02-coordinates.md) → [`docs/04-alignment-rules.md`](./docs/04-alignment-rules.md)
3. **Пойми продукт:** [`docs/05-user-journey.md`](./docs/05-user-journey.md) → [`docs/07-monetization-route.md`](./docs/07-monetization-route.md)
4. **Контент и логика:** папка [`content/`](./content/) + [`prompts/`](./prompts/)
5. **Пример качества:** [`examples/demo-person-answers.md`](./examples/demo-person-answers.md) + [`examples/demo-report-output.md`](./examples/demo-report-output.md)

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
│   └── 11-ui-page-spec.md
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
- Ступени 1–3: **готовые тексты**, не LLM; ступень 4: LLM-синтез
- Первое платное предложение: **одно**, не витрина
- Основатель: **разработчик, не лицо**; виральность через артефакт страницы
- Символические системы: **нулевое право утверждать**

## Следующие задачи разработки

1. ~~Вопросы-доборы под платные срезы~~ → `content/slices/`
2. ~~Сценарий UI личной страницы по ступеням~~ → `docs/11-ui-page-spec.md`
3. ~~Кликабельный прототип~~ → `prototype/`
4. **Ручной прогон 30 живых людей** — форма по `content/questions-ladder.md`, скоринг
   движком, ступень 4 и срезы руками через LLM. Метрики в `docs/09-validation.md`
5. Калибровка: переписать 10–15% текстов ветвей по реакциям
6. MVP-остаток: серверное хранение профилей, вызов LLM на ступени 4 и срезах, оплата

## История

Исходный Cloud Agent: https://cursor.com/agents/bc-01a07185-8d85-7333-85d2-133106afe504
