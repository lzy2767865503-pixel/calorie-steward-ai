import assert from "node:assert/strict";
import test from "node:test";

import {
  MealCommitFlowError,
  MealCommitIndeterminateError,
  commitMealAfterTemporaryPhotoCleanup,
  refreshAfterCommittedMeal,
} from "./mealCommit";

test("temporary photo deletion completes before the database meal commit", async () => {
  const calls: string[] = [];
  await commitMealAfterTemporaryPhotoCleanup({
    temporaryPhotoUri: "file:///cache/temporary.jpg",
    retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
    deletePrivateFile: async (uri) => {
      calls.push(`delete:${uri}`);
    },
    queuePrivateFileCleanup: async (uri) => {
      calls.push(`queue:${uri}`);
    },
    commitMeal: async () => {
      calls.push("commit");
    },
    verifyCommittedMeal: async () => {
      calls.push("verify");
      return false;
    },
  });
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "commit",
  ]);
});

test("temporary photo deletion failure prevents commit and rolls back the retained copy", async () => {
  const calls: string[] = [];
  await assert.rejects(
    commitMealAfterTemporaryPhotoCleanup({
      temporaryPhotoUri: "file:///cache/temporary.jpg",
      retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
      deletePrivateFile: async (uri) => {
        calls.push(`delete:${uri}`);
        if (uri.includes("temporary")) throw new Error("temporary delete failed");
      },
      queuePrivateFileCleanup: async (uri) => {
        calls.push(`queue:${uri}`);
      },
      commitMeal: async () => {
        calls.push("commit");
      },
      verifyCommittedMeal: async () => false,
    }),
    (error: unknown) =>
      error instanceof MealCommitFlowError &&
      error.temporaryPhotoDeleted === false &&
      /temporary delete failed/.test(error.message),
  );
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "delete:file:///documents/meal-photos/retained.jpg",
  ]);
});

test("database failure after temporary cleanup removes the uncommitted retained copy", async () => {
  const calls: string[] = [];
  await assert.rejects(
    commitMealAfterTemporaryPhotoCleanup({
      temporaryPhotoUri: "file:///cache/temporary.jpg",
      retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
      deletePrivateFile: async (uri) => {
        calls.push(`delete:${uri}`);
      },
      queuePrivateFileCleanup: async (uri) => {
        calls.push(`queue:${uri}`);
      },
      commitMeal: async () => {
        calls.push("commit");
        throw new Error("database unavailable");
      },
      verifyCommittedMeal: async () => false,
    }),
    (error: unknown) =>
      error instanceof MealCommitFlowError &&
      error.temporaryPhotoDeleted === true &&
      /database unavailable/.test(error.message),
  );
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "commit",
    "delete:file:///documents/meal-photos/retained.jpg",
  ]);
});

test("failed retained cleanup is durably queued before the commit error reaches the UI", async () => {
  const calls: string[] = [];
  await assert.rejects(
    commitMealAfterTemporaryPhotoCleanup({
      temporaryPhotoUri: "file:///cache/temporary.jpg",
      retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
      deletePrivateFile: async (uri) => {
        calls.push(`delete:${uri}`);
        if (uri.includes("meal-photos")) throw new Error("retained file locked");
      },
      queuePrivateFileCleanup: async (uri) => {
        calls.push(`queue:${uri}`);
      },
      commitMeal: async () => {
        calls.push("commit");
        throw new Error("database unavailable");
      },
      verifyCommittedMeal: async () => false,
    }),
    (error: unknown) =>
      error instanceof MealCommitFlowError &&
      error.temporaryPhotoDeleted === true &&
      /database unavailable/.test(error.message),
  );
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "commit",
    "delete:file:///documents/meal-photos/retained.jpg",
    "queue:file:///documents/meal-photos/retained.jpg",
  ]);
});

test("a cleanup queue failure is surfaced instead of being silently swallowed", async () => {
  await assert.rejects(
    commitMealAfterTemporaryPhotoCleanup({
      temporaryPhotoUri: "file:///cache/temporary.jpg",
      retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
      deletePrivateFile: async (uri) => {
        if (uri.includes("meal-photos")) throw new Error("retained file locked");
      },
      queuePrivateFileCleanup: async () => {
        throw new Error("settings unavailable");
      },
      commitMeal: async () => {
        throw new Error("database unavailable");
      },
      verifyCommittedMeal: async () => false,
    }),
    (error: unknown) =>
      error instanceof MealCommitFlowError &&
      /settings unavailable/.test(error.message),
  );
});

test("a transaction rejection that is durably present is reconciled as committed", async () => {
  const calls: string[] = [];
  const result = await commitMealAfterTemporaryPhotoCleanup({
    temporaryPhotoUri: "file:///cache/temporary.jpg",
    retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
    deletePrivateFile: async (uri) => {
      calls.push(`delete:${uri}`);
    },
    queuePrivateFileCleanup: async (uri) => {
      calls.push(`queue:${uri}`);
    },
    commitMeal: async () => {
      calls.push("commit");
      throw new Error("transaction close failed after COMMIT");
    },
    verifyCommittedMeal: async () => {
      calls.push("verify");
      return true;
    },
  });
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "commit",
    "verify",
  ]);
  assert.equal(result.reconciledAfterCommitError, true);
  assert.match(String(result.commitWarning), /close failed/);
});

test("an unknown commit state preserves retained evidence and prohibits retry", async () => {
  const calls: string[] = [];
  await assert.rejects(
    commitMealAfterTemporaryPhotoCleanup({
      temporaryPhotoUri: "file:///cache/temporary.jpg",
      retainedPhotoUri: "file:///documents/meal-photos/retained.jpg",
      deletePrivateFile: async (uri) => {
        calls.push(`delete:${uri}`);
      },
      queuePrivateFileCleanup: async (uri) => {
        calls.push(`queue:${uri}`);
      },
      commitMeal: async () => {
        calls.push("commit");
        throw new Error("transaction close failed");
      },
      verifyCommittedMeal: async () => {
        calls.push("verify");
        throw new Error("database unavailable");
      },
    }),
    (error: unknown) => error instanceof MealCommitIndeterminateError,
  );
  assert.deepEqual(calls, [
    "delete:file:///cache/temporary.jpg",
    "commit",
    "verify",
  ]);
});

test("a post-commit home refresh failure is reported separately and never rejects the commit flow", async () => {
  const refreshFailure = new Error("home query unavailable");
  const result = await refreshAfterCommittedMeal(async () => {
    throw refreshFailure;
  });
  assert.equal(result, refreshFailure);
  assert.equal(await refreshAfterCommittedMeal(async () => undefined), null);
});
