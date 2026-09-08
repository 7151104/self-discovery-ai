# Промпт: расчёт профиля

Rule Engine считает кодом обе ветки входа — лестницу 11+1 и полный банк 40+3
(`engine/src/scoring.ts`, функции `buildProfile` и `buildProfileFromBank`). В продукте
этот промпт не участвует.

Использовать для ручного прогона по банку: сверить расчёт движка на новом наборе ответов,
посчитать профиль до появления LLM-слоя, собрать эталон для калибровки (E5-11). Отчёт по
такому профилю пишется типом `бесплатный_полный` — тоже ручной формат
(`docs/06-report-structure.md`).

```text
По ответам пользователя и правилам из content/scoring-rules.md посчитай профиль.

Вход: таблица ответов {Q1: значение, ... O1: текст}

Для каждой из 16 координат выведи JSON:
{
  "coord_N": {
    "name": "...",
    "value": "...",
    "band": "low|mid-low|mid|mid-high|high",
    "confidence": "high|medium|low",
    "sources": ["Q4:B", ...],
    "flags": []
  }
}

Также:
- "flags_global": ["self_report_mismatch_11", ...]
- "contradictions": [{id, description}]
- "dominant_node": "NODE_..." (из step3-contradictions.md)
- "next_paid_offer": "..."

Правила:
1. Поведение > самооценка при конфликте
2. Q35 всегда low для coord 10
3. Открытые ответы подтверждают/отменяют coord 8, 10, 15, 16

Выведи только JSON, без пояснений.
```
