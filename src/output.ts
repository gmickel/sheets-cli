import type { ErrorCode, ErrorResult, Result, SuccessResult } from "./types";

export function success<T>(
  cmd: string,
  result: T,
  opts?: { spreadsheetId?: string; sheet?: string }
): SuccessResult<T> {
  return {
    ok: true,
    cmd,
    ...(opts?.spreadsheetId && { spreadsheetId: opts.spreadsheetId }),
    ...(opts?.sheet && { sheet: opts.sheet }),
    result,
  };
}

export function error(
  cmd: string,
  code: ErrorCode,
  message: string,
  details?: unknown
): ErrorResult {
  const errorObj: ErrorResult["error"] = { code, message };
  if (details !== undefined) {
    errorObj.details = details;
  }
  return { ok: false, cmd, error: errorObj };
}

export function output(result: Result): void {
  console.log(JSON.stringify(result, null, 2));
}

export function exitCode(result: Result): number {
  if (result.ok) {
    return 0;
  }
  switch (result.error.code) {
    case "VALIDATION_ERROR":
      return 10;
    case "AUTH_ERROR":
      return 20;
    case "PERMISSION_ERROR":
      return 30;
    case "API_ERROR":
      return 40;
    default:
      return 1;
  }
}
