/**
 * Версии профиля: снимок на каждое изменение ответов с указанием причины.
 *
 * Зачем: купленный блок написан по профилю, каким он был в момент покупки.
 * Чтобы понять, разошёлся ли он с сегодняшним человеком, нужен тот самый
 * профиль, а не сегодняшний. Отсюда же берётся отметка расхождения у платных
 * блоков (`engine/src/revision.ts`) и ответ на вопрос «что изменилось с тех пор».
 *
 * Снимок неизменяем: он копируется целиком, а не ссылается на живой профиль.
 * Хранилище версий — задача сервера (E3-03), здесь только сама лента и разбор.
 */

import type { Confidence, Profile } from "./types.js";

/** Почему сделан снимок. Причина обязательна: лента без причин нечитаема. */
export type SnapshotReason =
  /** Отвечена очередная порция лестницы или банка. */
  | "ответы"
  /** Человек изменил уже данный ответ. */
  | "правка ответа"
  /** Человек не согласился с блоком. */
  | "несогласие"
  /** Пришёл разбор открытого ответа: сюжет, задача периода, подтверждение текстом. */
  | "синтез"
  /** Учтены доборы платного среза. */
  | "добор"
  /** Оплачен срез: по этому снимку написан платный блок. */
  | "покупка";

export interface ProfileSnapshot {
  /** Порядковый номер версии, с единицы. */
  version: number;
  reason: SnapshotReason;
  /** Что именно случилось: «L2», «slice_node_finish», «ступень 3». */
  detail: string;
  /** Копия профиля целиком: последующие правки живого профиля её не трогают. */
  profile: Profile;
}

export interface ProfileHistory {
  entries: ProfileSnapshot[];
}

export const emptyHistory = (): ProfileHistory => ({ entries: [] });

/** Снимок профиля в ленту. Профиль копируется, ссылки на живой объект не остаётся. */
export function recordSnapshot(
  history: ProfileHistory,
  profile: Profile,
  reason: SnapshotReason,
  detail: string,
): ProfileHistory {
  const snapshot: ProfileSnapshot = {
    version: history.entries.length + 1,
    reason,
    detail,
    profile: structuredClone(profile),
  };
  return { entries: [...history.entries, snapshot] };
}

/** Снимок на момент покупки среза: по нему написан платный блок. */
export const recordPurchase = (history: ProfileHistory, profile: Profile, slice: string): ProfileHistory =>
  recordSnapshot(history, profile, "покупка", slice);

export const latestSnapshot = (history: ProfileHistory): ProfileSnapshot | null =>
  history.entries[history.entries.length - 1] ?? null;

export const snapshotAt = (history: ProfileHistory, version: number): ProfileSnapshot | null =>
  history.entries.find((entry) => entry.version === version) ?? null;

/**
 * Состояние профиля на момент покупки среза. Покупок одного среза дважды не
 * бывает (E8-07), но если снимков несколько, берётся первый: платный блок
 * написан по нему.
 */
export const snapshotAtPurchase = (history: ProfileHistory, slice: string): ProfileSnapshot | null =>
  history.entries.find((entry) => entry.reason === "покупка" && entry.detail === slice) ?? null;

/** Купленные срезы в порядке покупки. */
export const purchasedSlices = (history: ProfileHistory): string[] =>
  history.entries.filter((entry) => entry.reason === "покупка").map((entry) => entry.detail);

// ── Разница между версиями ────────────────────────────────────────────────────

export type CoordinateChange = "открылась" | "значение" | "полоса" | "уверенность" | "флаги";

export interface CoordinateDiff {
  coordinate: number;
  name: string;
  changes: CoordinateChange[];
  before: { code: string | null; confidence: Confidence } | null;
  after: { code: string | null; confidence: Confidence };
}

export interface ProfileDiff {
  coordinates: CoordinateDiff[];
  addedFlags: string[];
  removedFlags: string[];
  /** Сработавший узел до и после; null — узел не менялся. */
  node: { before: string | null; after: string | null } | null;
  /** Конфигурации доборов, появившиеся с прошлой версии. */
  addedConfigurations: string[];
}

const sortedFlags = (profile: Profile): string[] => [...profile.flags].sort();

/**
 * Что изменилось между двумя версиями профиля. Сравниваются только машинные
 * поля: значения координат наружу не отдаются, разница — тоже внутренняя.
 */
export function diffProfiles(before: Profile, after: Profile): ProfileDiff {
  const coordinates: CoordinateDiff[] = [];

  for (const state of Object.values(after.coordinates)) {
    const previous = before.coordinates[state.id];
    const changes: CoordinateChange[] = [];

    if (!previous || previous.sources.length === 0) {
      if (state.sources.length === 0) continue;
      changes.push("открылась");
    } else {
      if (previous.code !== state.code) changes.push("значение");
      if (previous.band !== state.band) changes.push("полоса");
      if (previous.confidence !== state.confidence) changes.push("уверенность");
      if (previous.flags.join(",") !== state.flags.join(",")) changes.push("флаги");
    }

    if (!changes.length) continue;
    coordinates.push({
      coordinate: state.id,
      name: state.name,
      changes,
      before: previous && previous.sources.length ? { code: previous.code, confidence: previous.confidence } : null,
      after: { code: state.code, confidence: state.confidence },
    });
  }

  const beforeFlags = sortedFlags(before);
  const afterFlags = sortedFlags(after);
  const beforeConfigurations = new Set(before.configurations.map((configuration) => configuration.code));

  return {
    coordinates,
    addedFlags: afterFlags.filter((flag) => !beforeFlags.includes(flag)),
    removedFlags: beforeFlags.filter((flag) => !afterFlags.includes(flag)),
    node:
      before.dominantNode === after.dominantNode
        ? null
        : { before: before.dominantNode, after: after.dominantNode },
    addedConfigurations: after.configurations
      .map((configuration) => configuration.code)
      .filter((code) => !beforeConfigurations.has(code)),
  };
}

/** Разница пуста — профиль с той версии не двигался. */
export const isSameProfile = (diff: ProfileDiff): boolean =>
  diff.coordinates.length === 0 &&
  diff.addedFlags.length === 0 &&
  diff.removedFlags.length === 0 &&
  diff.node === null &&
  diff.addedConfigurations.length === 0;

/** Что изменилось в профиле с момента покупки среза до текущего состояния. */
export function diffSincePurchase(history: ProfileHistory, slice: string, current: Profile): ProfileDiff | null {
  const snapshot = snapshotAtPurchase(history, slice);
  return snapshot ? diffProfiles(snapshot.profile, current) : null;
}
