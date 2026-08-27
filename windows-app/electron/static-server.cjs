"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const MIME_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; "),
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function requestPath(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return null;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, candidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return candidate;
}

function createStaticServer({ root, host = "127.0.0.1", port = 47823 }) {
  const absoluteRoot = path.resolve(root);
  const expectedHost = `${host}:${port}`;
  if (!fs.existsSync(path.join(absoluteRoot, "index.html"))) {
    throw new Error("The packaged web export is missing index.html.");
  }

  const server = http.createServer((request, response) => {
    const hostHeader = request.headers.host;
    if (hostHeader !== expectedHost || !["GET", "HEAD"].includes(request.method || "")) {
      response.writeHead(400, SECURITY_HEADERS);
      response.end();
      return;
    }
    const candidate = requestPath(absoluteRoot, request.url || "/");
    if (!candidate) {
      response.writeHead(404, SECURITY_HEADERS);
      response.end();
      return;
    }
    let file = candidate;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(file)) {
        response.writeHead(404, SECURITY_HEADERS);
        response.end();
        return;
      }
      file = path.join(absoluteRoot, "index.html");
    }
    const extension = path.extname(file).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) {
      response.writeHead(415, SECURITY_HEADERS);
      response.end();
      return;
    }
    const headers = {
      ...SECURITY_HEADERS,
      "Content-Type": contentType,
      "Content-Length": fs.statSync(file).size,
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;

  return {
    origin: `http://${expectedHost}`,
    start: () =>
      new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

module.exports = { SECURITY_HEADERS, createStaticServer, requestPath };
