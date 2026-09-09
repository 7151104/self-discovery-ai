# AI-самопознание — полный пакет проекта

Многомодельный AI-сервис самопознания для русскоязычной аудитории.  
**Статус:** концепция и контент готовы. Есть кликабельный мобильный прототип воронки: [`prototype/`](./prototype/).

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
│   └── 10-business-context.md
├── content/                ← вопросы, ветви, скоринг (продуктовое ядро)
│   ├── questions-full-bank.md
│   ├── questions-ladder.md
│   ├── scoring-rules.md
│   ├── step0-welcome.md
│   ├── step1-branches.md
│   ├── step2-branches.md
│   ├── step3-contradictions.md
│   └── step4-open-synthesis.md
├── prompts/                ← промпты для LLM
│   ├── full-report-assembler.md
│   ├── profile-calculator.md
│   └── paid-slice-templates.md
└── examples/               ← демо для калибровки качества
    ├── demo-person-answers.md
    └── demo-report-output.md
```

## Ключевые решения (не пересматривать без запроса основателя)

- Модели **не пишут пользователю** — только питают 16 координат
- Дата рождения: **вход и визуал**, ноль выводов о личности
- Бесплатный продукт: **лестница из 4 ступеней**, не один большой тест
- Ступени 1–3: **готовые тексты**, не LLM; ступень 4: LLM-синтез
- Первое платное предложение: **одно**, не витрина
- Основатель: **разработчик, не лицо**; виральность через артефакт страницы
- Символические системы: **нулевое право утверждать**

## Следующие задачи разработки

1. Дописать вопросы-доборы под платные срезы (узел, работа, отношения)
2. Сценарий UI личной страницы по ступеням — визуальный якорь: [`docs/ui-mockups/`](./docs/ui-mockups/)
3. Ручной прогон 5–10 живых людей (форма + LLM)
4. Кликабельный прототип — [`prototype/`](./prototype/) (воронка на телефоне)
5. MVP: профиль координат + rule engine + страница + оплата

## История

Исходный Cloud Agent: https://cursor.com/agents/bc-01a07185-8d85-7333-85d2-133106afe504
