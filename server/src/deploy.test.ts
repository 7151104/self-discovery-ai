/**
 * Выпуск и откат (E10-03).
 *
 * Проверяется механика: порядок шагов, переключение ссылки, версия сборки в
 * окружении выпуска, отказ до переключения и откат одной командой. Настоящие
 * миграции и копия базы подменены заглушками, которые пишут в журнал шагов, —
 * их собственные тесты живут в `migrations.test.ts` и `backup.test.ts`.
 *
 * Чего этот тест не проверяет: работу на настоящей площадке. Площадка и домен
 * ждут ответа основателя (открытые вопросы 4 и 29), а сами скрипты от них не
 * зависят: им нужна только машина с systemd.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOY_DIR = fileURLToPath(new URL("../../deploy/", import.meta.url));

/**
 * Заглушка команды выпуска: пишет свой вызов в журнал шагов и завершается
 * успехом. Провал изображается переменной `SDAI_TEST_FAIL`.
 */
const stub = (name: string): string => `
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.SDAI_TEST_STEPS, "${name} " + (process.argv[2] || "") + "\\n");
process.exit(process.env.SDAI_TEST_FAIL === "${name}:" + (process.argv[2] || "") ? 1 : 0);
`;

interface Sandbox {
  root: string;
  build: string;
  steps: string;
  restarts: string;
  env: NodeJS.ProcessEnv;
}

function sandbox(t: { after(fn: () => void): void }): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "sdai-deploy-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const root = join(base, "srv");
  const build = join(base, "build");
  const steps = join(base, "steps.log");
  const restarts = join(base, "restarts.log");

  mkdirSync(join(build, "server", "dist", "db"), { recursive: true });
  writeFileSync(join(build, "server", "dist", "db", "migrate.js"), stub("migrate"));
  writeFileSync(join(build, "server", "dist", "db", "backup.js"), stub("backup"));

  // Файл окружения площадки: из него скрипт берёт переменные службы.
  const envFile = join(base, "production.env");
  writeFileSync(envFile, "SDAI_BUILD_COMMIT=0123456789abcdef\n");

  // Перезапуск службы: на машине это `systemctl restart sdai`, здесь — отметка.
  const restart = join(base, "restart.sh");
  writeFileSync(restart, `#!/bin/sh\necho restart >> ${restarts}\n`, { mode: 0o755 });

  return {
    root,
    build,
    steps,
    restarts,
    env: {
      ...process.env,
      SDAI_ROOT: root,
      SDAI_ENV_FILE: envFile,
      SDAI_NODE: process.execPath,
      SDAI_RESTART: restart,
      SDAI_TEST_STEPS: steps,
    },
  };
}

function run(box: Sandbox, script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}): string {
  return execFileSync("sh", [join(DEPLOY_DIR, script), ...args], {
    env: { ...box.env, ...extra },
    encoding: "utf8",
  });
}

const stepsOf = (box: Sandbox): string[] =>
  existsSync(box.steps) ? readFileSync(box.steps, "utf8").trim().split("\n") : [];

const currentRelease = (box: Sandbox): string => basename(readlinkSync(join(box.root, "current")));

test("выпуск проверяет миграции, снимает копию и только потом переключает ссылку", (t) => {
  const box = sandbox(t);

  run(box, "release.sh", [box.build, "2026-09-08-1"]);

  // Порядок жёсткий: несовместимая миграция должна останавливать выпуск до
  // переключения, а копия базы — существовать до применения миграций.
  assert.deepEqual(stepsOf(box), ["migrate check", "backup create", "migrate up"]);
  assert.equal(currentRelease(box), "2026-09-08-1");
  assert.equal(readFileSync(box.restarts, "utf8").trim(), "restart");

  // Версия сборки лежит в окружении самого выпуска: откат меняет её вместе со
  // ссылкой, отдельного шага для этого не нужно.
  const release = readFileSync(join(box.root, "releases", "2026-09-08-1", "release.env"), "utf8");
  assert.match(release, /^SDAI_BUILD_VERSION=2026-09-08-1$/m);
  assert.match(release, /^SDAI_BUILD_COMMIT=0123456789abcdef$/m);
  assert.match(release, /^SDAI_BUILD_AT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
});

test("несовместимая миграция останавливает выпуск, служба остаётся на прежней версии", (t) => {
  const box = sandbox(t);
  run(box, "release.sh", [box.build, "первый"]);
  rmSync(box.steps);

  try {
    run(box, "release.sh", [box.build, "второй"], { SDAI_TEST_FAIL: "migrate:check" });
    assert.fail("выпуск с несовместимой миграцией прошёл");
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    assert.equal(failure.status, 1);
    assert.match(failure.stderr ?? "", /миграции выпуска несовместимы/);
  }

  // До копии и применения не дошло, ссылка осталась на прежнем выпуске.
  assert.deepEqual(stepsOf(box), ["migrate check"]);
  assert.equal(currentRelease(box), "первый");
  assert.equal(readFileSync(box.restarts, "utf8").trim(), "restart");
});

test("откат возвращает предыдущий выпуск одной командой и повторяется обратно", (t) => {
  const box = sandbox(t);
  run(box, "release.sh", [box.build, "первый"]);
  run(box, "release.sh", [box.build, "второй"]);
  assert.equal(currentRelease(box), "второй");

  const back = run(box, "rollback.sh");
  assert.match(back, /Откат на выпуск первый выполнен/);
  assert.equal(currentRelease(box), "первый");

  // Повторный откат возвращает обратно: «предыдущим» стал тот, с которого ушли.
  run(box, "rollback.sh");
  assert.equal(currentRelease(box), "второй");
});

test("откат отказывается работать, когда возвращаться некуда", (t) => {
  const box = sandbox(t);
  run(box, "release.sh", [box.build, "первый"]);

  try {
    run(box, "rollback.sh");
    assert.fail("откат прошёл без предыдущего выпуска");
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    assert.equal(failure.status, 1);
    assert.match(failure.stderr ?? "", /предыдущий выпуск неизвестен/);
  }
  assert.equal(currentRelease(box), "первый");
});

test("версия выпуска не переписывается: тот же номер второй раз отклоняется", (t) => {
  const box = sandbox(t);
  run(box, "release.sh", [box.build, "первый"]);

  try {
    run(box, "release.sh", [box.build, "первый"]);
    assert.fail("выпуск разложился поверх себя");
  } catch (error) {
    assert.match((error as { stderr?: string }).stderr ?? "", /уже разложен/);
  }
});

test("старые выпуски удаляются, но откат остаётся возможным", (t) => {
  const box = sandbox(t);
  for (const version of ["первый", "второй", "третий"]) {
    run(box, "release.sh", [box.build, version], { SDAI_KEEP_RELEASES: "2" });
  }

  const left = readdirSync(join(box.root, "releases"));
  assert.equal(left.length, 2, `осталось: ${left.join(", ")}`);
  assert.ok(left.includes("третий"), "текущий выпуск удалён");

  // Откат по-прежнему выполним: предыдущий выпуск из числа оставшихся.
  const previous = readFileSync(join(box.root, "previous"), "utf8").trim();
  assert.ok(left.includes(previous), "предыдущий выпуск удалён вместе со старыми");
});
