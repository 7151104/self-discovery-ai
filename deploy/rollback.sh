#!/bin/sh
# Откат к предыдущему выпуску одной командой (E10-03): deploy/rollback.sh
#
# Откат переключает ссылку `current` на предыдущий выпуск и перезапускает
# службу. Версия сборки в ответе `GET /api/health` меняется вместе со ссылкой:
# она лежит в окружении самого выпуска, а не в общем файле.
#
# Схему базы откат не трогает. Так и задумано: миграции откатываются отдельной
# командой и осознанно, потому что откат схемы теряет данные, а откат кода —
# нет. Если предыдущий выпуск не понимает новую схему:
#   node $SDAI_ROOT/current/server/dist/db/migrate.js down --steps=<сколько>
# Копия базы до выпуска уже снята: её снял deploy/release.sh.
set -eu

ROOT="${SDAI_ROOT:-/srv/sdai}"
RESTART="${SDAI_RESTART:-systemctl restart sdai}"

die() {
  echo "Откат не выполнен: $1" >&2
  exit 1
}

[ -f "$ROOT/previous" ] || die "предыдущий выпуск неизвестен: файла $ROOT/previous нет"
PREVIOUS="$(cat "$ROOT/previous")"
[ -n "$PREVIOUS" ] || die "имя предыдущего выпуска пустое"

TARGET="$ROOT/releases/$PREVIOUS"
[ -d "$TARGET" ] || die "каталога выпуска $PREVIOUS нет: он уже удалён по сроку хранения"

# Текущий выпуск становится «предыдущим»: повторный откат вернёт обратно.
if [ -L "$ROOT/current" ]; then
  basename "$(readlink "$ROOT/current")" > "$ROOT/previous"
fi

ln -sfn "$TARGET" "$ROOT/current"
# shellcheck disable=SC2086
$RESTART || die "служба не перезапустилась после переключения на $PREVIOUS"

echo "Откат на выпуск $PREVIOUS выполнен. Проверка: curl -s \$SDAI_PUBLIC_ORIGIN/api/health"
