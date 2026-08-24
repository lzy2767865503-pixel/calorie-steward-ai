export class MealCommitFlowError extends Error {
  readonly temporaryPhotoDeleted: boolean;
  readonly originalError: unknown;

  constructor(originalError: unknown, temporaryPhotoDeleted: boolean) {
    super(
      originalError instanceof Error
        ? originalError.message
        : "Meal commit failed.",
    );
    this.name = "MealCommitFlowError";
    this.originalError = originalError;
    this.temporaryPhotoDeleted = temporaryPhotoDeleted;
  }
}

export class MealCommitIndeterminateError extends Error {
  readonly commitError: unknown;
  readonly verificationError: unknown;

  constructor(commitError: unknown, verificationError: unknown) {
    super("数据库提交后无法确认该餐是否已保存。");
    this.name = "MealCommitIndeterminateError";
    this.commitError = commitError;
    this.verificationError = verificationError;
  }
}

export type MealCommitResult = {
  reconciledAfterCommitError: boolean;
  commitWarning: unknown | null;
};

async function cleanupUncommittedRetainedPhoto(args: {
  retainedPhotoUri: string | null;
  deletePrivateFile: (uri: string) => Promise<void>;
  queuePrivateFileCleanup: (uri: string) => Promise<void>;
  originalError: unknown;
  temporaryPhotoDeleted: boolean;
}): Promise<never> {
  if (args.retainedPhotoUri) {
    try {
      await args.deletePrivateFile(args.retainedPhotoUri);
    } catch (cleanupError) {
      try {
        await args.queuePrivateFileCleanup(args.retainedPhotoUri);
      } catch (queueError) {
        const originalMessage =
          args.originalError instanceof Error
            ? args.originalError.message
            : "Meal commit failed.";
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : "file cleanup failed";
        const queueMessage =
          queueError instanceof Error ? queueError.message : "cleanup queue failed";
        throw new MealCommitFlowError(
          new Error(
            `${originalMessage} 未提交照片副本清理失败，且无法加入重试队列：${cleanupMessage}；${queueMessage}`,
          ),
          args.temporaryPhotoDeleted,
        );
      }
    }
  }
  throw new MealCommitFlowError(
    args.originalError,
    args.temporaryPhotoDeleted,
  );
}

/**
 * A meal is never committed until its temporary camera file is confirmed
 * absent. If anything fails before commit, an uncommitted retained copy is
 * removed (or queued for a later retry) before the error reaches the UI.
 */
export async function commitMealAfterTemporaryPhotoCleanup(args: {
  temporaryPhotoUri: string;
  retainedPhotoUri: string | null;
  deletePrivateFile: (uri: string) => Promise<void>;
  queuePrivateFileCleanup: (uri: string) => Promise<void>;
  commitMeal: () => Promise<void>;
  verifyCommittedMeal: () => Promise<boolean>;
}): Promise<MealCommitResult> {
  try {
    await args.deletePrivateFile(args.temporaryPhotoUri);
  } catch (error) {
    return cleanupUncommittedRetainedPhoto({
      retainedPhotoUri: args.retainedPhotoUri,
      deletePrivateFile: args.deletePrivateFile,
      queuePrivateFileCleanup: args.queuePrivateFileCleanup,
      originalError: error,
      temporaryPhotoDeleted: false,
    });
  }

  try {
    await args.commitMeal();
    return { reconciledAfterCommitError: false, commitWarning: null };
  } catch (commitError) {
    let committed: boolean;
    try {
      committed = await args.verifyCommittedMeal();
    } catch (verificationError) {
      // The transaction may have committed before its close/cleanup promise
      // rejected. Preserve any retained copy and prohibit a retry when the
      // durable state cannot be distinguished.
      throw new MealCommitIndeterminateError(commitError, verificationError);
    }
    if (committed) {
      return {
        reconciledAfterCommitError: true,
        commitWarning: commitError,
      };
    }
    return cleanupUncommittedRetainedPhoto({
      retainedPhotoUri: args.retainedPhotoUri,
      deletePrivateFile: args.deletePrivateFile,
      queuePrivateFileCleanup: args.queuePrivateFileCleanup,
      originalError: commitError,
      temporaryPhotoDeleted: true,
    });
  }
}

/** Post-commit presentation work must never be reclassified as a failed write. */
export async function refreshAfterCommittedMeal(
  refresh: () => Promise<void>,
): Promise<unknown | null> {
  try {
    await refresh();
    return null;
  } catch (error) {
    return error;
  }
}
