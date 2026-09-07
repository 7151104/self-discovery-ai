// Статический сервер для прототипа. Без зависимостей: node tools/serve.mjs

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  // Редирект, а не отдача файла: иначе относительные ./style.css и ./app.js
  // разрешаются от корня и отваливаются в 404.
  if (url.pathname === "/") {
    response.writeHead(302, { location: "/prototype/" }).end();
    return;
  }

  const path = join(root, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));

  if (!path.startsWith(root)) {
    response.writeHead(403).end("forbidden");
    return;
  }

  try {
    const info = await stat(path);
    const file = info.isDirectory() ? join(path, "index.html") : path;
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("404");
  }
}).listen(port, () => {
  console.log(`Прототип: http://localhost:${port}/`);
});
