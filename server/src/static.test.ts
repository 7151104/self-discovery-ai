/**
 * Настоящий клиент по постоянной ссылке (E7-13): документ SPA, статика
 * из `web/dist`, обход каталога невозможен.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { uiCopy } from "./engine.js";
import { CLIENT_SCRIPT, CLIENT_STYLE, resolvePublicFile, serveStatic, webDistRoot } from "./http/static.js";
import { call, profileAtStep, startTestServer } from "./test-support.js";

const rawGet = (origin: string, path: string): Promise<{ status: number; body: string }> =>
  new Promise((done, fail) => {
    const url = new URL(origin);
    const request = http.get({ hostname: url.hostname, port: url.port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk as Buffer));
      response.on("end", () =>
        done({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    request.on("error", fail);
  });

const title = (): string => uiCopy("UI_PAGE_TITLE");
const noscript = (): string => uiCopy("UI_PAGE_NOSCRIPT");

const isClientDocument = (html: string): void => {
  assert.match(html, /<div id="app"><\/div>/);
  assert.ok(html.includes(`src="${CLIENT_SCRIPT}"`));
  assert.ok(html.includes(`href="${CLIENT_STYLE}"`));
  assert.match(html, /type="module"/);
  assert.ok(html.includes(`<title>${title()}</title>`));
  assert.ok(html.includes(noscript()));
  assert.ok(!html.includes('data-role="state"'), "вернулась временная оболочка E3-04");
  assert.ok(!html.includes('data-role="map"'), "вернулась временная оболочка E3-04");
};

test("resolvePublicFile не выпускает за корень dist", () => {
  const root = "/var/sdai/web/dist";
  assert.equal(resolvePublicFile("/web/src/app.js", root), resolve(root, "src/app.js"));
  assert.equal(resolvePublicFile("/web/app.css", root), resolve(root, "app.css"));

  const escapes = [
    "/web/../package.json",
    "/web/../../package.json",
    "/web/src/../../package.json",
    "/web/src/app.js/../../../package.json",
    "/web/%2e%2e/package.json",
    "/web/%2e%2e/%2e%2e/package.json",
    "/web/src/%2e%2e/%2e%2e/package.json",
    "/web/..%2fpackage.json",
    "/web/src/app.js%2f..%2f..%2fpackage.json",
    "/web/src/app.js%00.css",
  ];
  for (const path of escapes) {
    assert.equal(resolvePublicFile(path, root), null, path);
  }

  assert.equal(resolvePublicFile("/web/", root), null);
  assert.equal(resolvePublicFile("/web", root), null);
  assert.equal(resolvePublicFile("/api/health", root), null);
});

test("симлинк наружу из dist не отдаётся", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sdai-static-"));
  const dist = join(dir, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "ok.js"), "export {};");
  writeFileSync(join(dir, "secret.txt"), "секрет-снаружи");
  symlinkSync(join(dir, "secret.txt"), join(dist, "leak.js"));

  try {
    const leaked = await serveStatic("/web/leak.js", {}, dist);
    assert.equal(leaked?.status, 404);
    assert.equal(String(leaked?.body ?? ""), "");

    const ok = await serveStatic("/web/ok.js", {}, dist);
    assert.equal(ok?.status, 200);
    assert.equal(ok?.headers["content-type"], "text/javascript; charset=utf-8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("адрес /p/{id} отдаёт документ клиента, а не временную оболочку", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const page = await profileAtStep(server.origin, 1);
  const response = await fetch(`${server.origin}/p/${page.profileId}`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  isClientDocument(html);
  assert.ok(!html.includes(page.card.name), "имя не должно быть в оболочке до JS");
  assert.ok(!html.includes(page.blocks[0]?.heading ?? "нет блока"));
});

test("публичная ссылка /s/{token} отдаёт тот же документ клиента", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await profileAtStep(server.origin, 2);
  const shared = await call<{ share: { url: string } }>(server.origin, "POST", `/api/p/${created.profileId}/share`, null);
  const token = (shared.body.share.url ?? "").slice(shared.body.share.url.lastIndexOf("/") + 1);

  const response = await fetch(`${server.origin}/s/${token}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  isClientDocument(html);
});

test("корень сервера отдаёт тот же документ — вход без профиля", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${server.origin}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  isClientDocument(html);
});

test("модули и стили клиента отдаются с типом содержимого и ETag", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const css = await fetch(`${server.origin}${CLIENT_STYLE}`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  const cssEtag = css.headers.get("etag");
  assert.ok(cssEtag);
  assert.match(await css.text(), /:root/);

  const again = await fetch(`${server.origin}${CLIENT_STYLE}`, { headers: { "if-none-match": cssEtag ?? "" } });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");

  const js = await fetch(`${server.origin}${CLIENT_SCRIPT}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /javascript/);
  const source = await js.text();
  assert.match(source, /createPageApp/);

  const imported = [...source.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)].map((match) => match[1] ?? "");
  assert.ok(imported.length > 0, "у точки входа нет относительных импортов");
  for (const spec of imported) {
    const url = new URL(spec, `${server.origin}${CLIENT_SCRIPT}`);
    const reply = await fetch(url);
    assert.equal(reply.status, 200, url.pathname);
    assert.match(reply.headers.get("content-type") ?? "", /javascript/);
  }
});

test("попытка обхода каталога web/dist не отдаёт чужие файлы", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const marker = "self-discovery-ai";
  const attempts = [
    "/web/../package.json",
    "/web/../../package.json",
    "/web/src/../../package.json",
    "/web/%2e%2e/package.json",
    "/web/%2e%2e/%2e%2e/package.json",
    "/web/src/%2e%2e/%2e%2e/package.json",
    "/web/..%2fpackage.json",
    "/web/src/app.js/../../../package.json",
    "/web/src/app.js%2f..%2f..%2fpackage.json",
  ];

  for (const path of attempts) {
    const response = await rawGet(server.origin, path);
    assert.notEqual(response.status, 200, path);
    assert.ok(!response.body.includes(marker), `обход ${path} отдал package.json`);
    assert.ok(!response.body.includes('"private": true'), `обход ${path} отдал package.json`);
  }

  const missing = await fetch(`${server.origin}/web/no-such-file.js`);
  assert.equal(missing.status, 404);
});

test("корень dist указывает на web/dist", () => {
  assert.ok(webDistRoot().endsWith("web/dist"));
});
