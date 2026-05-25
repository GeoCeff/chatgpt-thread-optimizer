import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const port = Number(process.env.PORT || 5173);
const host = "127.0.0.1";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

function resolveRequestPath(url) {
  const parsedUrl = new URL(url, `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, safePath));

  if (!filePath.startsWith(root)) {
    return null;
  }

  return decodedPath.endsWith("/") ? join(filePath, "index.html") : filePath;
}

const server = createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url || "/");

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extname(filePath)) || "application/octet-stream"
    });
    response.end(body);
  } catch (_error) {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Thread Lite demo running at http://${host}:${port}/demo/`);
});
