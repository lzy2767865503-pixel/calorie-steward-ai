import {
  openDatabaseAsync,
  type SQLiteDatabase,
} from "expo-sqlite";

import {
  DATABASE_NAME,
  LATEST_SCHEMA_VERSION,
  MIGRATION_LEDGER_SQL,
  MIGRATIONS,
  validateMigrationPlan,
} from "./schema";

type UserVersionRow = { user_version: number };

let databasePromise: Promise<SQLiteDatabase> | null = null;

async function readUserVersion(database: SQLiteDatabase): Promise<number> {
  const row = await database.getFirstAsync<UserVersionRow>("PRAGMA user_version");
  if (!row || !Number.isInteger(row.user_version) || row.user_version < 0) {
    throw new Error("Unable to read a valid SQLite user_version.");
  }
  return row.user_version;
}

export async function migrateDatabase(database: SQLiteDatabase): Promise<void> {
  validateMigrationPlan();
  await database.execAsync(MIGRATION_LEDGER_SQL);

  const initialVersion = await readUserVersion(database);
  if (initialVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${initialVersion} is newer than this app supports (${LATEST_SCHEMA_VERSION}).`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= initialVersion) continue;

    await database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await readUserVersion(transaction);
      if (current >= migration.version) return;
      if (current !== migration.version - 1) {
        throw new Error(
          `Refusing non-contiguous database migration ${current} -> ${migration.version}.`,
        );
      }

      await transaction.execAsync(migration.sql);
      await transaction.runAsync(
        `INSERT INTO schema_migrations(version, name, applied_at_utc)
         VALUES (?, ?, ?)`,
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }

  const finalVersion = await readUserVersion(database);
  if (finalVersion !== LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database migration stopped at ${finalVersion}; expected ${LATEST_SCHEMA_VERSION}.`,
    );
  }

  const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
    "PRAGMA foreign_keys",
  );
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("SQLite foreign-key enforcement is not active.");
  }
}

async function openAndInitializeDatabase(databaseName: string): Promise<SQLiteDatabase> {
  const database = await openDatabaseAsync(databaseName);
  await database.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);
  await migrateDatabase(database);
  return database;
}

export function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openAndInitializeDatabase(DATABASE_NAME).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

/** Used by controlled test/dev teardown only; application code should keep one connection. */
export async function closeStorageDatabase(): Promise<void> {
  const pending = databasePromise;
  databasePromise = null;
  if (pending) {
    const database = await pending;
    await database.closeAsync();
  }
}

