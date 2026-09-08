/**
 * Токены дизайн-системы. Единственный источник: CSS-переменные собираются
 * отсюда скриптом `web/scripts/build-styles.mjs`, тесты и линтер стилей читают
 * этот же файл. Второго списка значений в репозитории нет.
 *
 * Правило, из которого всё следует: в CSS компонентов не бывает ни одного
 * литерального цвета и ни одного литерального пикселя. Любое значение приходит
 * через `var(--…)`, а имя переменной обязано найтись здесь — иначе падает
 * линтер (`web/src/lint/styles.ts`).
 *
 * Задачи E6-02 (типографика), E6-03 (цвет и контраст), E6-04 (сетка, отступы,
 * радиусы, тени, длительности).
 */

/** Размер корневого шрифта браузера по умолчанию. Все `rem` считаются от него. */
export const ROOT_FONT_SIZE_PX = 16;

/** Базовая ширина мобильного экрана, от которой проектируется вёрстка. */
export const BASE_VIEWPORT_PX = 360;

/** Высота базового мобильного экрана: в неё целиком помещается карта. */
export const BASE_VIEWPORT_HEIGHT_PX = 640;

export const rem = (px: number): number => px / ROOT_FONT_SIZE_PX;
export const px = (value: number): number => value * ROOT_FONT_SIZE_PX;

// ── Типографика (E6-02) ───────────────────────────────────────────────────────

export interface FontSizeToken {
  name: string;
  rem: number;
  /** Назначение. Размер без назначения в шкале не живёт. */
  purpose: string;
}

/**
 * Шесть размеров и ни одного больше. Основной текст разбора — `text-md`:
 * 16 px попадает в 16–18 px из `docs/11-ui-page-spec.md` и держит длину строки
 * в 34–46 знаков на экране 360 px. Размер задан в rem от настроек браузера,
 * поэтому масштаб текста 200% работает без правок вёрстки.
 */
export const FONT_SIZES: FontSizeToken[] = [
  { name: "text-xs", rem: rem(13), purpose: "счётчик слов, подписи полюсов шкалы, мелкие пометки" },
  { name: "text-sm", rem: rem(14), purpose: "вспомогательный текст: подписи полос, действия блока, подписи дверей" },
  { name: "text-md", rem: rem(16), purpose: "основной текст: абзацы разбора, варианты ответа, текст вопроса" },
  { name: "text-lg", rem: rem(20), purpose: "заголовок блока, сшивка, заголовок предложения" },
  { name: "text-xl", rem: rem(24), purpose: "фраза-крючок — единственный крупный текст на странице" },
  { name: "text-2xl", rem: rem(30), purpose: "имя в шапке, ступень 0" },
];

/** Основной текст разбора: на нём считается длина строки. */
export const BODY_SIZE_NAME = "text-md";

export interface FontWeightToken {
  name: string;
  value: number;
  purpose: string;
}

/** Три начертания. Четвёртого нет: тон спокойный, играть весом не на чем. */
export const FONT_WEIGHTS: FontWeightToken[] = [
  { name: "weight-regular", value: 400, purpose: "весь основной текст" },
  { name: "weight-medium", value: 500, purpose: "сшивка, подписи полос, активные подписи" },
  { name: "weight-strong", value: 640, purpose: "заголовки, имя, крючок" },
];

export interface LeadingToken {
  name: string;
  value: number;
  purpose: string;
}

export const LEADINGS: LeadingToken[] = [
  { name: "leading-tight", value: 1.25, purpose: "заголовки и крючок" },
  { name: "leading-snug", value: 1.4, purpose: "варианты ответа, подписи, короткие строки" },
  { name: "leading-normal", value: 1.55, purpose: "абзацы разбора" },
];

export interface MeasureToken {
  name: string;
  ch: number;
  purpose: string;
}

/**
 * Длина строки в знаках. Ограничение задаётся в `ch`, потому что `ch` едет
 * вместе с масштабом текста, а пиксельная ширина — нет.
 */
export const MEASURES: MeasureToken[] = [
  { name: "measure-block", ch: 36, purpose: "абзацы блока разбора: 34–46 знаков" },
  { name: "measure-hook", ch: 28, purpose: "фраза-крючок: читается без контекста" },
];

/** Приёмка E6-02: длина строки блока разбора на базовом экране. */
export const MEASURE_RANGE = { min: 34, max: 46 } as const;

/**
 * Доля от размера шрифта, которую занимает средний знак кириллицы в системном
 * гротеске, вместе с пробелами. У Arial это 0.50 (строчные ≈ 0.55 em, пробел
 * 0.28 em), у экранных гротесков Apple и Android — немного уже. Точное
 * значение зависит от шрифта устройства, поэтому длина строки проверяется по
 * диапазону, а не по одному числу; пиксельно точный замер — визуальные
 * регрессии E11-04.
 */
export const CHAR_WIDTH_RATIO = { min: 0.46, max: 0.54 } as const;

// ── Цвет (E6-03) ──────────────────────────────────────────────────────────────

export interface ColorToken {
  name: string;
  hex: string;
  purpose: string;
}

/** Нейтральная шкала. На ней держится вся страница. */
export const NEUTRALS: ColorToken[] = [
  { name: "color-surface-card", hex: "#ffffff", purpose: "поверхность блока, карточки, поля" },
  { name: "color-surface-page", hex: "#fbfbfa", purpose: "фон страницы" },
  { name: "color-surface-muted", hex: "#f1f1ef", purpose: "приглушённая поверхность: отключённое, пустая полоса" },
  { name: "color-surface-inset", hex: "#e8e8e5", purpose: "дорожка полосы карты, желоб шкалы" },
  { name: "color-line", hex: "#dcdcd8", purpose: "тонкая граница" },
  { name: "color-line-strong", hex: "#b4b5b1", purpose: "контур выбранного и контур пустой полосы" },
  { name: "color-text-faint", hex: "#666a73", purpose: "текст отключённого состояния" },
  { name: "color-text-soft", hex: "#4f5563", purpose: "вспомогательный текст" },
  { name: "color-text", hex: "#14161a", purpose: "основной текст" },
  { name: "color-text-strong", hex: "#0b0d10", purpose: "заголовки, сшивка, чёткий маркер карты" },
];

/**
 * Смысловых цветов два. Акцент — только действие и активный маркер карты,
 * тревога — только ошибка ввода и кризисный контур. Третий смысловой цвет
 * не понадобился: состояния различаются формой, а не оттенком.
 */
export const SEMANTIC_COLORS: ColorToken[] = [
  { name: "color-accent", hex: "#1d4ed8", purpose: "действие и активный маркер карты — больше нигде" },
  { name: "color-alert", hex: "#a3161c", purpose: "ошибка ввода и кризисный контур" },
];

/** Производные от смысловых: текст на акценте и его тихие подложки. */
export const SEMANTIC_DERIVED: ColorToken[] = [
  { name: "color-accent-contrast", hex: "#ffffff", purpose: "текст на акцентной поверхности" },
  { name: "color-accent-quiet", hex: "#eef2ff", purpose: "подложка выбранного варианта" },
  { name: "color-focus", hex: "#1d4ed8", purpose: "кольцо фокуса с клавиатуры" },
];

export interface ColorRole {
  role: string;
  foreground: string;
  background: string;
  /** Минимальный контраст по WCAG. Проверяется тестом, а не глазом. */
  min: number;
}

/**
 * Пары «текст на поверхности», которые обязаны держать контраст.
 * Основной текст — не ниже 7:1, вспомогательный — не ниже 4.5:1
 * (`docs/12-target-state.md`, 5.8).
 */
export const COLOR_ROLES: ColorRole[] = [
  { role: "основной текст на странице", foreground: "color-text", background: "color-surface-page", min: 7 },
  { role: "основной текст на карточке", foreground: "color-text", background: "color-surface-card", min: 7 },
  { role: "заголовок на карточке", foreground: "color-text-strong", background: "color-surface-card", min: 7 },
  { role: "основной текст на приглушённой поверхности", foreground: "color-text", background: "color-surface-muted", min: 7 },
  { role: "вспомогательный текст на карточке", foreground: "color-text-soft", background: "color-surface-card", min: 4.5 },
  { role: "вспомогательный текст на странице", foreground: "color-text-soft", background: "color-surface-page", min: 4.5 },
  { role: "вспомогательный текст на приглушённой поверхности", foreground: "color-text-soft", background: "color-surface-muted", min: 4.5 },
  { role: "текст отключённого состояния", foreground: "color-text-faint", background: "color-surface-muted", min: 4.5 },
  { role: "действие на карточке", foreground: "color-accent", background: "color-surface-card", min: 4.5 },
  { role: "текст на акцентной кнопке", foreground: "color-accent-contrast", background: "color-accent", min: 4.5 },
  { role: "текст ошибки на карточке", foreground: "color-alert", background: "color-surface-card", min: 4.5 },
  { role: "кольцо фокуса на карточке", foreground: "color-focus", background: "color-surface-card", min: 3 },
  { role: "кольцо фокуса на странице", foreground: "color-focus", background: "color-surface-page", min: 3 },
  { role: "выбранный вариант", foreground: "color-text", background: "color-accent-quiet", min: 7 },
];

// ── Сетка, отступы, радиусы, тени, длительности (E6-04) ───────────────────────

export interface SpaceToken {
  name: string;
  px: number;
  purpose: string;
}

/** Шкала кратна четырём, семь ступеней. Значение вне шкалы не проходит линтер. */
export const SPACE_BASE_PX = 4;

export const SPACES: SpaceToken[] = [
  { name: "space-1", px: 4, purpose: "зазор между подписью и значением" },
  { name: "space-2", px: 8, purpose: "внутренний зазор мелких элементов" },
  { name: "space-3", px: 12, purpose: "зазор между полосами карты, между отметками шкалы" },
  { name: "space-4", px: 16, purpose: "поля карточки на мобильном, зазор абзацев" },
  { name: "space-5", px: 24, purpose: "внутренние поля блока, зазор блока и действий" },
  { name: "space-6", px: 32, purpose: "зазор между блоками страницы" },
  { name: "space-7", px: 48, purpose: "воздух вокруг крючка и точки оплаты" },
];

/** Единый вертикальный ритм блока: одинаков во всех состояниях блока. */
export const BLOCK_RHYTHM = {
  padding: "space-4",
  gap: "space-4",
} as const;

/** Поля страницы на базовом экране. От них считается длина строки. */
export const PAGE_GUTTER = "space-3";

export interface RadiusToken {
  name: string;
  px: number;
  purpose: string;
}

export const RADII: RadiusToken[] = [
  { name: "radius-sm", px: 8, purpose: "поле ввода, мелкая кнопка" },
  { name: "radius-md", px: 14, purpose: "карточка, блок, дверь" },
  { name: "radius-pill", px: 999, purpose: "дорожка полосы, маркер, отметка шкалы" },
];

export interface ShadowToken {
  name: string;
  value: string;
  purpose: string;
}

/** Две тени. Тень — способ отделить поверхность, а не украшение. */
export const SHADOWS: ShadowToken[] = [
  { name: "shadow-none", value: "none", purpose: "плоские поверхности и все закрытые состояния" },
  { name: "shadow-card", value: "0 1px 2px rgba(11, 13, 16, 0.04), 0 8px 24px rgba(11, 13, 16, 0.05)", purpose: "блок разбора, карточка порции" },
  { name: "shadow-raised", value: "0 2px 4px rgba(11, 13, 16, 0.06), 0 12px 32px rgba(11, 13, 16, 0.08)", purpose: "предложенная платная дверь и точка оплаты" },
];

export interface DurationToken {
  name: string;
  ms: number;
  purpose: string;
}

/**
 * Длительности. Ни одной дольше 600 мс: путь прохождения не ждёт анимацию
 * (`docs/12-target-state.md`, 5.5).
 */
export const DURATIONS: DurationToken[] = [
  { name: "duration-fast", ms: 120, purpose: "фокус, наведение, нажатие" },
  { name: "duration-base", ms: 240, purpose: "появление блока и смена состояния двери" },
  { name: "duration-marker", ms: 480, purpose: "приезд маркера карты из центра — один раз" },
];

/** Приёмка E6-07: маркер едет 400–600 мс. */
export const MARKER_DURATION_RANGE = { min: 400, max: 600 } as const;

export interface BorderToken {
  name: string;
  px: number;
  purpose: string;
}

/** Толщины линий: единственный источник пиксельных границ. */
export const BORDERS: BorderToken[] = [
  { name: "border-hair", px: 1, purpose: "обычная граница" },
  { name: "border-strong", px: 2, purpose: "выбранное состояние, кольцо фокуса" },
  { name: "border-heavy", px: 3, purpose: "левая линейка сшивки: сильнее абзацев без цвета" },
];

export interface SizeToken {
  name: string;
  rem: number;
  purpose: string;
}

/** Минимальная интерактивная цель: 44 px (`docs/11-ui-page-spec.md`). */
export const MIN_TARGET_PX = 44;

export const SIZES: SizeToken[] = [
  { name: "size-target", rem: rem(44), purpose: "минимальная интерактивная цель — 44 px" },
  { name: "size-mark", rem: rem(20), purpose: "видимая отметка шкалы внутри цели 44 px" },
  { name: "size-bar-track", rem: rem(20), purpose: "высота дорожки полосы карты" },
  { name: "size-bar-marker", rem: rem(14), purpose: "маркер полосы карты" },
  { name: "size-dot", rem: rem(10), purpose: "точка категориальной полосы" },
  { name: "size-field", rem: rem(152), purpose: "открытое поле: шесть строк текста" },
  { name: "size-container", rem: rem(560), purpose: "предельная ширина страницы на десктопе" },
  { name: "size-screen", rem: rem(360), purpose: "базовый мобильный экран" },
];

// ── Плоский реестр ────────────────────────────────────────────────────────────

/** Все токены в виде `имя → значение CSS`. Из него собирается `tokens.css`. */
export const TOKENS: Record<string, string> = {
  ...Object.fromEntries(FONT_SIZES.map((token) => [token.name, `${token.rem}rem`])),
  ...Object.fromEntries(FONT_WEIGHTS.map((token) => [token.name, String(token.value)])),
  ...Object.fromEntries(LEADINGS.map((token) => [token.name, String(token.value)])),
  ...Object.fromEntries(MEASURES.map((token) => [token.name, `${token.ch}ch`])),
  ...Object.fromEntries(NEUTRALS.map((token) => [token.name, token.hex])),
  ...Object.fromEntries(SEMANTIC_COLORS.map((token) => [token.name, token.hex])),
  ...Object.fromEntries(SEMANTIC_DERIVED.map((token) => [token.name, token.hex])),
  ...Object.fromEntries(SPACES.map((token) => [token.name, `${rem(token.px)}rem`])),
  ...Object.fromEntries(RADII.map((token) => [token.name, `${token.px}px`])),
  ...Object.fromEntries(SHADOWS.map((token) => [token.name, token.value])),
  ...Object.fromEntries(DURATIONS.map((token) => [token.name, `${token.ms}ms`])),
  ...Object.fromEntries(BORDERS.map((token) => [token.name, `${token.px}px`])),
  ...Object.fromEntries(SIZES.map((token) => [token.name, `${token.rem}rem`])),
  "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif',
};

/** Группы для витрины: показать шкалу целиком и назначение каждого значения. */
export const TOKEN_GROUPS = [
  { title: "Размеры текста", items: FONT_SIZES.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Начертания", items: FONT_WEIGHTS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Межстрочные", items: LEADINGS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Длина строки", items: MEASURES.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Нейтральная шкала", items: NEUTRALS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Смысловые цвета", items: [...SEMANTIC_COLORS, ...SEMANTIC_DERIVED].map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Отступы", items: SPACES.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Радиусы", items: RADII.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Тени", items: SHADOWS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Длительности", items: DURATIONS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Границы", items: BORDERS.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
  { title: "Размеры", items: SIZES.map((t) => ({ name: t.name, value: TOKENS[t.name] ?? "", purpose: t.purpose })) },
];

/** Значение токена в пикселях, если оно длина. Иначе null. */
export function tokenPx(name: string): number | null {
  const value = TOKENS[name];
  if (value === undefined) return null;
  const match = /^(-?[\d.]+)(rem|px)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "rem" ? px(amount) : amount;
}

/** Текст `web/dist/tokens.css`: корень страницы и объявление всех переменных. */
export function tokensCss(): string {
  const lines = Object.entries(TOKENS).map(([name, value]) => `  --${name}: ${value};`);
  return [
    "/* Собран из web/tokens/tokens.ts. Не править руками: перезаписывается сборкой. */",
    ":root {",
    ...lines,
    "}",
    "",
  ].join("\n");
}
