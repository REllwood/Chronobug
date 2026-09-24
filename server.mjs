import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(directory, "public");
const exposedModules = new Map([
  ["/virtual-clock-core.mjs", path.join(directory, "src", "virtual-clock.mjs")],
  ["/zoned-time-core.mjs", path.join(directory, "src", "zoned-time.mjs")]
]);
const argument = process.argv.find((value) => value.startsWith("--port="));
const requested = argument ? argument.slice("--port=".length) : process.env.PORT || "4175";
if (!/^\d+$/.test(requested) || Number(requested) > 65535) {
  console.error(`Invalid port "${requested}". Use a whole number from 0 to 65535.`);
  process.exit(1);
}
const port = Number(requested);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response
      .writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" })
      .end("Method not allowed");
    return;
  }
  try {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const candidate =
      exposedModules.get(pathname) ??
      path.resolve(publicRoot, pathname === "/" ? "index.html" : pathname.slice(1));
    const allowed =
      [...exposedModules.values()].includes(candidate) ||
      candidate === path.join(publicRoot, "index.html") ||
      candidate.startsWith(`${publicRoot}${path.sep}`);
    if (!allowed) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!(await stat(candidate)).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "content-type": contentTypes.get(path.extname(candidate)) ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(await readFile(candidate));
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Choose another with --port=<number>.`
      : `Chronobug could not start: ${error.message}`
  );
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const activePort = typeof address === "object" && address ? address.port : port;
  console.log(`Chronobug listening at http://127.0.0.1:${activePort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
