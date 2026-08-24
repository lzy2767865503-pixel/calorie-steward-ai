import { getDatabase } from "./database";
import { mapProfileRow, type DatabaseRow } from "./rowMappers";
import { assertNonSecretSettingKey } from "./secretPolicy";
import type {
  SettingRecord,
  StoredUserProfile,
  UserProfileWrite,
} from "./types";
import { assertLocalDate, assertNoSensitivePayload } from "./validation";
import { advanceReportInputRevision } from "./reportInputState";

export async function saveProfile(profile: UserProfileWrite): Promise<StoredUserProfile> {
  if (!profile.id.trim()) throw new Error("Profile id must not be blank.");
  if (profile.birthDate) assertLocalDate(profile.birthDate, "profile.birthDate");
  if (profile.weightKg !== null && (!Number.isFinite(profile.weightKg) || profile.weightKg <= 0)) {
    throw new Error("profile.weightKg must be positive or null.");
  }
  if (
    profile.dailyEnergyTargetKcal !== null &&
    (!Number.isFinite(profile.dailyEnergyTargetKcal) || profile.dailyEnergyTargetKcal <= 0)
  ) {
    throw new Error("profile.dailyEnergyTargetKcal must be positive or null.");
  }
  if (!profile.populationGroup.trim()) throw new Error("profile.populationGroup is required.");
  if (!profile.locale.trim()) throw new Error("profile.locale is required.");

  const now = new Date().toISOString();
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO profiles (
         id, birth_date, weight_kg, daily_energy_target_kcal,
         population_group, special_conditions_json, locale,
         created_at_utc, updated_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         birth_date = excluded.birth_date,
         weight_kg = excluded.weight_kg,
         daily_energy_target_kcal = excluded.daily_energy_target_kcal,
         population_group = excluded.population_group,
         special_conditions_json = excluded.special_conditions_json,
         locale = excluded.locale,
         updated_at_utc = excluded.updated_at_utc`,
      profile.id,
      profile.birthDate,
      profile.weightKg,
      profile.dailyEnergyTargetKcal,
      profile.populationGroup,
      JSON.stringify(profile.specialConditions),
      profile.locale,
      now,
      now,
    );
    await advanceReportInputRevision(transaction, now);
  });
  const stored = await getProfile(profile.id);
  if (!stored) throw new Error(`Profile ${profile.id} disappeared after save.`);
  return stored;
}

export async function getProfile(id: string): Promise<StoredUserProfile | null> {
  const row = await (await getDatabase()).getFirstAsync<DatabaseRow>(
    "SELECT * FROM profiles WHERE id = ?",
    id,
  );
  return row ? mapProfileRow(row) : null;
}

export async function getMostRecentlyUpdatedProfile(): Promise<StoredUserProfile | null> {
  const row = await (await getDatabase()).getFirstAsync<DatabaseRow>(
    "SELECT * FROM profiles ORDER BY updated_at_utc DESC, id DESC LIMIT 1",
  );
  return row ? mapProfileRow(row) : null;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const database = await getDatabase();
  let changed = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync("DELETE FROM profiles WHERE id = ?", id);
    changed = result.changes === 1;
    if (changed) await advanceReportInputRevision(transaction);
  });
  return changed;
}

export async function setSetting<T>(key: string, value: T): Promise<SettingRecord<T>> {
  assertNonSecretSettingKey(key);
  if (value === undefined) throw new Error("SQLite settings cannot store undefined.");
  assertNoSensitivePayload(value, `settings.${key}`);
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) throw new Error("Setting value is not JSON serializable.");
  const now = new Date().toISOString();
  await (await getDatabase()).runAsync(
    `INSERT INTO settings(key, value_json, updated_at_utc)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at_utc = excluded.updated_at_utc`,
    key,
    valueJson,
    now,
  );
  return { key, value, updatedAtUtc: now };
}

export async function getSetting<T>(key: string): Promise<SettingRecord<T> | null> {
  assertNonSecretSettingKey(key);
  const row = await (await getDatabase()).getFirstAsync<{
    key: string;
    value_json: string;
    updated_at_utc: string;
  }>("SELECT key, value_json, updated_at_utc FROM settings WHERE key = ?", key);
  if (!row) return null;
  return {
    key: row.key,
    value: JSON.parse(row.value_json) as T,
    updatedAtUtc: row.updated_at_utc,
  };
}

export async function listSettings(): Promise<readonly SettingRecord[]> {
  const rows = await (await getDatabase()).getAllAsync<{
    key: string;
    value_json: string;
    updated_at_utc: string;
  }>("SELECT key, value_json, updated_at_utc FROM settings ORDER BY key");
  return rows.map((row) => ({
    key: row.key,
    value: JSON.parse(row.value_json) as unknown,
    updatedAtUtc: row.updated_at_utc,
  }));
}

export async function deleteSetting(key: string): Promise<boolean> {
  assertNonSecretSettingKey(key);
  const result = await (await getDatabase()).runAsync(
    "DELETE FROM settings WHERE key = ?",
    key,
  );
  return result.changes === 1;
}
