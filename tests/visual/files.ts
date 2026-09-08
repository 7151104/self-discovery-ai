/**
 * Имена файлов эталонов и путь к каталогу.
 *
 * Эталоны лежат в репозитории рядом с кодом сверки. Прогон их только читает.
 */

import { join } from "node:path";
import { repoRoot } from "../paths.js";
import type { PageStateId } from "../states.js";
import type { Viewport } from "./viewport.js";

export type SnapshotSource = "showcase" | "live";

export const baselinesDir = (): string => join(repoRoot, "tests", "visual", "baselines");

export const baselineFile = (source: SnapshotSource, state: PageStateId, viewport: Viewport): string =>
  `${source}-${state}-${viewport.id}.txt`;

export const baselinePath = (source: SnapshotSource, state: PageStateId, viewport: Viewport): string =>
  join(baselinesDir(), baselineFile(source, state, viewport));
