#!/bin/sh
# Выпуск (E10-03). Один запуск — один выпуск, без ручных шагов.
#
# Раскладка на машине:
#   $SDAI_ROOT/releases/<версия>   каталоги выпусков, каждый — собранное дерево
#   $SDAI_ROOT/current             ссылка на текущий выпуск, её и читает служба
#   $SDAI_ROOT/previous            имя предыдущего выпуска, из него берёт откат
#
# База и копии живут вне каталога выпуска (SDAI_DB_PATH, SDAI_BACKUP_DIR):
# выпуск заменяется, данные — нет.
#
# Порядок жёсткий: проверить миграции нового выпуска, снять копию базы,
# применить миграции, только потом переключить ссылку и перезапустить службу.
# Несовместимая миграция останавливает выпуск до переключения, поэтому служба
# продолжает работать на прежней версии.
#
# Использование: deploy/release.sh <каталог-сборки> <версия>
set -eu

ROOT="${SDAI_ROOT:-/srv/sdai}"
ENV_FILE="${SDAI_ENV_FILE:-/etc/sdai/production.env}"
RESTART="${SDAI_RESTART:-systemctl restart sdai}"
NODE="${SDAI_NODE:-node}"
KEEP="${SDAI_KEEP_RELEASES:-5}"

die() {
  echo "Выпуск остановлен: $1" >&2
  exit 1
}

BUILD="${1:-}"
VERSION="${2:-}"
[ -n "$BUILD" ] || die "не указан каталог сборки"
[ -n "$VERSION" ] || die "не указана версия выпуска"
[ -d "$BUILD" ] || die "каталога сборки нет: $BUILD"

RELEASE="$ROOT/releases/$VERSION"
[ -e "$RELEASE" ] || true
[ ! -e "$RELEASE" ] || die "выпуск $VERSION уже разложен: версии не переписываются"

# Переменные окружения службы нужны и здесь: миграции и копия ходят в ту же базу.
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

mkdir -p "$ROOT/releases"
cp -R "$BUILD" "$RELEASE"

# Версия сборки уезжает в окружение выпуска, а не в общий файл: откат
# переключает ссылку, и версия в ответе /api/health меняется вместе с ней.
{
  echo "SDAI_BUILD_VERSION=$VERSION"
  echo "SDAI_BUILD_COMMIT=${SDAI_BUILD_COMMIT:-unknown}"
  echo "SDAI_BUILD_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$RELEASE/release.env"

"$NODE" "$RELEASE/server/dist/db/migrate.js" check || die "миграции выпуска несовместимы"
"$NODE" "$RELEASE/server/dist/db/backup.js" create || die "копия базы не снялась"
"$NODE" "$RELEASE/server/dist/db/migrate.js" up || die "миграции не применились"

if [ -L "$ROOT/current" ]; then
  basename "$(readlink "$ROOT/current")" > "$ROOT/previous"
fi

ln -sfn "$RELEASE" "$ROOT/current"
# shellcheck disable=SC2086
$RESTART || die "служба не перезапустилась; откат: deploy/rollback.sh"

# Старые выпуски: последние $KEEP остаются, чтобы откат было куда делать.
ls -1dt "$ROOT"/releases/* 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  [ "$old" = "$RELEASE" ] || rm -rf "$old"
done

echo "Выпуск $VERSION развёрнут. Проверка: curl -s \$SDAI_PUBLIC_ORIGIN/api/health"
