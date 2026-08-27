"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SECURITY_HEADERS, requestPath } = require("../electron/static-server.cjs");

test("requestPath confines decoded paths to the export root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "calorie-static-"));
  try {
    assert.equal(requestPath(root, "/"), path.join(root, "index.html"));
    assert.equal(requestPath(root, "/assets/app.js"), path.join(root, "assets", "app.js"));
    assert.equal(requestPath(root, "/..%2Foutside"), null);
    assert.equal(requestPath(root, "/%5Coutside"), null);
    assert.equal(requestPath(root, "/bad%00name"), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("security headers enable SQLite isolation and deny privileged features", () => {
  assert.equal(SECURITY_HEADERS["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(SECURITY_HEADERS["Cross-Origin-Embedder-Policy"], "require-corp");
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /object-src 'none'/);
  assert.match(SECURITY_HEADERS["Permissions-Policy"], /camera=\(\)/);
});
