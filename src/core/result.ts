// @covers AC-021, AC-023, AC-130, AC-131, AC-132
// 全入口（Web UI・API・サーバMCP・WebMCP）で共通のエラー表現
export type ErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: ErrorCode, message: string): Result<T> => ({ ok: false, code, message });

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};
