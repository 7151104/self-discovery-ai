/**
 * Линтер контента (E11-06).
 *
 * Проверяет тексты, которые видит человек, и эталон в examples/. Реестр и
 * сопоставитель — у движка; здесь только запуск и печать отчёта по-русски.
 * Отказ роняет команду, предупреждение — нет.
 */

import { formatLintReport, lintCorpus } from "../engine/dist/content-linter.js";

const report = lintCorpus();
process.stdout.write(formatLintReport(report));
process.exit(report.rejects.length > 0 ? 1 : 0);
