import assert from "node:assert/strict";
import test from "node:test";

import { AiProviderError } from "../ai";
import { userFacingError } from "./errors";

test("AI errors are localized without losing the provider request ID", () => {
  const error = new AiProviderError({
    code: "AUTH_FAILED",
    message: "raw provider message",
    providerKind: "openai_responses",
    providerRequestId: "req_123",
  });
  assert.match(userFacingError(error, "zh"), /凭据被拒绝/);
  assert.match(userFacingError(error, "en"), /credential was rejected/i);
  assert.match(userFacingError(error, "en"), /req_123/);
});

test("internal Chinese details do not leak into the English interface", () => {
  assert.doesNotMatch(userFacingError(new Error("数据库内部错误"), "en"), /数据库/);
  assert.equal(userFacingError(undefined, "en"), "An unknown error occurred. No record was written.");
});

test("internal English details do not leak into the Chinese interface", () => {
  assert.equal(
    userFacingError(new Error("database row checksum mismatch"), "zh"),
    "操作未能安全完成，没有写入未确认的记录。",
  );
});
