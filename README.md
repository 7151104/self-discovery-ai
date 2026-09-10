# AI-самопознание — полный пакет проекта

Многомодельный AI-сервис самопознания для русскоязычной аудитории.  
**Статус:** активная разработка, концепция и контент готовы, код ещё не начат.

## Для нового агента — начни здесь

1. **Прочитай полностью:** [`AGENT-BOOTSTRAP.md`](./AGENT-BOOTSTRAP.md) — главный документ входа, правила работы, что не ломать.
2. **Пойми систему:** [`docs/01-architecture.md`](./docs/01-architecture.md) → [`docs/02-coordinates.md`](./docs/02-coordinates.md) → [`docs/04-alignment-rules.md`](./docs/04-alignment-rules.md)
3. **Пойми продукт:** [`docs/05-user-journey.md`](./docs/05-user-journey.md) → [`docs/07-monetization-route.md`](./docs/07-monetization-route.md)
4. **Единственный активный шаг — пилот:** [`docs/15-pilot-scene-fork.md`](./docs/15-pilot-scene-fork.md) → [`examples/pilot-go-to-market.md`](./examples/pilot-go-to-market.md)
5. **Смыслы и замороженные пути:** [`docs/14-values-and-paths.md`](./docs/14-values-and-paths.md)
6. **Контент и логика:** папка [`content/`](./content/) + [`prompts/`](./prompts/)
7. **Пример качества:** [`examples/demo-person-answers.md`](./examples/demo-person-answers.md) + [`examples/demo-report-output.md`](./examples/demo-report-output.md)

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
│   ├── 11-daily-ritual-and-social.md   ← заморожено до пилота
│   ├── 14-values-and-paths.md
│   └── 15-pilot-scene-fork.md          ← АКТИВНЫЙ ПИЛОТ
├── content/                ← вопросы, ветви, скоринг, банк развилок
│   ├── questions-full-bank.md
│   ├── questions-ladder.md
│   ├── scoring-rules.md
│   ├── daily-signal-bank.md            ← заморожено
│   ├── pilot-scene-fork-bank.md        ← банк пилота
│   ├── step0-welcome.md
│   ├── step1-branches.md
│   ├── step2-branches.md
│   ├── step3-contradictions.md
│   └── step4-open-synthesis.md
├── prompts/                ← промпты для LLM
│   ├── full-report-assembler.md
│   ├── profile-calculator.md
│   ├── paid-slice-templates.md
│   └── daily-signal.md
└── examples/               ← демо для калибровки качества
    ├── demo-person-answers.md
    ├── demo-report-output.md
    ├── pilot-go-to-market.md       ← скрипты: с чем идти к людям
    ├── manual-return-test-protocol.md  ← архив (3 гипотезы)
    └── signal-pitch/index.html     ← презентация (не для пилота)
```

## Ключевые решения (не пересматривать без запроса основателя)

- Модели **не пишут пользователю** — только питают 16 координат
- Дата рождения: **вход и визуал**, ноль выводов о личности
- Бесплатный продукт: **лестница из 4 ступеней**, не один большой тест
- Пилот сейчас: **развилка перед сценой**, не ежедневный текст и не гороскоп
- Ступени 1–3: **готовые тексты**, не LLM; ступень 4: LLM-синтез
- Первое платное предложение: **одно**, не витрина
- Основатель: **разработчик, не лицо**; виральность через артефакт страницы
- Символические системы: **нулевое право утверждать**

## Следующие задачи

1. **Сейчас:** пилот «Развилка перед сценой» — 5 человек, 2 недели ([`examples/pilot-go-to-market.md`](./examples/pilot-go-to-market.md))
2. По результатам пилота: MVP (форма + разбор + 4 сцены + lookup) **или** одна новая гипотеза
3. После зелёного пилота: вопросы-доборы под срезы, UI страницы, код

## История

Исходный Cloud Agent: https://cursor.com/agents/bc-01a07185-8d85-7333-85d2-133106afe504
