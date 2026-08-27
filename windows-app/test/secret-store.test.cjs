"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSecretStore } = require("../electron/secret-store.cjs");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join(""), "utf8"),
  decryptString: (value) => [...value.toString("utf8")].reverse().join(""),
};

test("credential store encrypts, reads, replaces, and deletes without plaintext", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calorie-secret-"));
  try {
    const store = createSecretStore({ safeStorage: fakeSafeStorage, directory });
    const key = "diet-steward.api-secret.v1.provider-demo";
    await store.set(key, "sk-example-secret");
    assert.equal(await store.get(key), "sk-example-secret");
    const raw = await fs.readFile(path.join(directory, "credentials.v1.bin"), "utf8");
    assert.equal(raw.includes("sk-example-secret"), false);
    await store.set(key, "sk-replaced-secret");
    assert.equal(await store.get(key), "sk-replaced-secret");
    await store.delete(key);
    assert.equal(await store.get(key), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("credential store fails closed on a corrupt record", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calorie-secret-corrupt-"));
  try {
    await fs.writeFile(path.join(directory, "credentials.v1.bin"), "not-json");
    const store = createSecretStore({ safeStorage: fakeSafeStorage, directory });
    await assert.rejects(
      store.set("diet-steward.api-secret.v1.provider-demo", "sk-example-secret"),
      /corrupt/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
