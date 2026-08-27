"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const KEY_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

function assertKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new Error("Credential key is invalid.");
  }
}

function assertValue(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 16_384) {
    throw new Error("Credential value is invalid.");
  }
}

function createSecretStore({ safeStorage, directory }) {
  const filePath = path.join(directory, "credentials.v1.bin");
  let lock = Promise.resolve();

  const serialized = async (operation) => {
    const previous = lock;
    let release;
    lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const requireEncryption = () => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows credential encryption is unavailable.");
    }
  };

  const readRecord = async () => {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.version !== 1 ||
        !parsed.entries ||
        typeof parsed.entries !== "object" ||
        Array.isArray(parsed.entries)
      ) {
        throw new Error("invalid record");
      }
      for (const [key, value] of Object.entries(parsed.entries)) {
        assertKey(key);
        if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
          throw new Error("invalid encrypted entry");
        }
      }
      return parsed;
    } catch (error) {
      if (error && error.code === "ENOENT") return { version: 1, entries: {} };
      throw new Error("The encrypted credential store is corrupt; refusing to overwrite it.");
    }
  };

  const writeRecord = async (record) => {
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      await fs.rename(temporary, filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  };

  return {
    get: (key) =>
      serialized(async () => {
        assertKey(key);
        requireEncryption();
        const record = await readRecord();
        const encrypted = record.entries[key];
        if (!encrypted) return null;
        try {
          return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        } catch {
          throw new Error("The stored credential cannot be decrypted for this Windows user.");
        }
      }),
    set: (key, value) =>
      serialized(async () => {
        assertKey(key);
        assertValue(value);
        requireEncryption();
        const record = await readRecord();
        record.entries[key] = safeStorage.encryptString(value).toString("base64");
        await writeRecord(record);
      }),
    delete: (key) =>
      serialized(async () => {
        assertKey(key);
        requireEncryption();
        const record = await readRecord();
        if (!record.entries[key]) return;
        delete record.entries[key];
        if (Object.keys(record.entries).length === 0) {
          await fs.rm(filePath, { force: true });
          return;
        }
        await writeRecord(record);
      }),
  };
}

module.exports = { createSecretStore };
