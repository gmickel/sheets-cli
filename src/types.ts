// Default spreadsheet ID from environment variable (user-specific, not committed to repo)
// Set SHEETS_CLI_DEFAULT_SPREADSHEET_ID in your shell or .env file
export const DEFAULT_SPREADSHEET_ID: string | undefined =
  process.env.SHEETS_CLI_DEFAULT_SPREADSHEET_ID;

// Parse Google Sheets URL to extract spreadsheet ID
// Supports: https://docs.google.com/spreadsheets/d/ID/edit#gid=0
const SHEETS_URL_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

export function parseSpreadsheetId(input: string): string {
  // If it looks like a URL, extract the ID
  if (input.includes("docs.google.com") || input.includes("/spreadsheets/d/")) {
    const match = input.match(SHEETS_URL_REGEX);
    if (match?.[1]) {
      return match[1];
    }
  }
  // Otherwise return as-is (already an ID)
  return input;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "PERMISSION_ERROR"
  | "API_ERROR";

export type SuccessResult<T = unknown> = {
  ok: true;
  cmd: string;
  spreadsheetId?: string;
  sheet?: string;
  result: T;
};

export type ErrorResult = {
  ok: false;
  cmd: string;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

export type Result<T = unknown> = SuccessResult<T> | ErrorResult;

export type BatchOperation =
  | {
      op: "append";
      sheet: string;
      values: Record<string, unknown>;
    }
  | {
      op: "updateRow";
      sheet: string;
      row: number;
      set: Record<string, unknown>;
    }
  | {
      op: "updateKey";
      sheet: string;
      keyCol: string;
      key: string;
      set: Record<string, unknown>;
      allowMulti?: boolean;
    }
  | {
      op: "setRange";
      range: string;
      values: unknown[][];
    };

export type ValueInputOption = "USER_ENTERED" | "RAW";

export type GuardrailsConfig = {
  enabled: boolean;
  allowedSpreadsheets?: string[];
  allowedSheets?: string[];
  writableColumns?: string[];
};
