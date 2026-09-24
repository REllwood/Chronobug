import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.mjs", import.meta.url));

function launch(args) {
  const child = spawn(process.execPath, [serverPath, ...args], {
    env: { ...process.env, PORT: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve({ code, stdout, stderr })));
  const listening = new Promise((resolve) => {
    child.stdout.on("data", () => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    exited.then(() => resolve(null));
  });
  return { child, listening, exited };
}

function send(port, method, rawPath) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: "127.0.0.1", port, method, path: rawPath }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

let server;
let port;

before(async () => {
  server = launch(["--port=0"]);
  port = await server.listening;
  assert.ok(port, "the server should start on an ephemeral port");
});

after(() => server.child.kill());

test("serves the lab page and its modules", async () => {
  const page = await send(port, "GET", "/");
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.match(page.body, /<title>Chronobug<\/title>/);
  for (const modulePath of ["/app.mjs", "/lab-logic.mjs", "/virtual-clock-core.mjs", "/zoned-time-core.mjs"]) {
    const response = await send(port, "GET", modulePath);
    assert.equal(response.status, 200, modulePath);
    assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8", modulePath);
  }
});

test("refuses paths outside the public folder", async () => {
  for (const rawPath of [
    "/server.mjs",
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/..%2Fserver.mjs",
    "/../src/virtual-clock.mjs",
    "/public",
    "/missing.html"
  ]) {
    const response = await send(port, "GET", rawPath);
    assert.equal(response.status, 404, rawPath);
  }
});

test("answers HEAD without a body and rejects other methods", async () => {
  const head = await send(port, "HEAD", "/");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  for (const method of ["POST", "PUT", "DELETE"]) {
    const response = await send(port, method, "/");
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "GET, HEAD", method);
  }
});

test("rejects an invalid port with a clear message", async () => {
  for (const value of ["-1", "70000", "abc", "4175abc", ""]) {
    const { code, stderr } = await launch([`--port=${value}`]).exited;
    assert.equal(code, 1, value);
    assert.match(stderr, /Invalid port ".*"\. Use a whole number from 0 to 65535\./, value);
  }
});

test("explains when the port is already in use", async () => {
  const { code, stderr } = await launch([`--port=${port}`]).exited;
  assert.equal(code, 1);
  assert.equal(stderr.trim(), `Port ${port} is already in use. Choose another with --port=<number>.`);
});
