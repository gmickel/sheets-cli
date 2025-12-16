import { describe, expect, test } from "bun:test";
import { DEFAULT_SPREADSHEET_ID, parseSpreadsheetId } from "../types";

const SHEETS_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

describe("DEFAULT_SPREADSHEET_ID", () => {
  test("is undefined when env var not set", () => {
    // DEFAULT_SPREADSHEET_ID comes from SHEETS_CLI_DEFAULT_SPREADSHEET_ID env var
    // In test environment without env var set, it should be undefined
    const envValue = process.env.SHEETS_CLI_DEFAULT_SPREADSHEET_ID;
    if (envValue) {
      expect(DEFAULT_SPREADSHEET_ID).toBe(envValue);
      expect(DEFAULT_SPREADSHEET_ID).toMatch(SHEETS_ID_REGEX);
    } else {
      expect(DEFAULT_SPREADSHEET_ID).toBeUndefined();
    }
  });
});

describe("parseSpreadsheetId", () => {
  test("returns ID as-is when given plain ID", () => {
    const id = "abc123-XYZ_test-456";
    expect(parseSpreadsheetId(id)).toBe(id);
  });

  test("extracts ID from full Google Sheets URL", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/abc123-XYZ_test-456/edit#gid=0";
    expect(parseSpreadsheetId(url)).toBe("abc123-XYZ_test-456");
  });

  test("extracts ID from URL without fragment", () => {
    const url = "https://docs.google.com/spreadsheets/d/abc123-XYZ_test/edit";
    expect(parseSpreadsheetId(url)).toBe("abc123-XYZ_test");
  });

  test("extracts ID from minimal URL path", () => {
    const url = "docs.google.com/spreadsheets/d/mySheetId123/";
    expect(parseSpreadsheetId(url)).toBe("mySheetId123");
  });

  test("handles URL with query params", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing";
    expect(parseSpreadsheetId(url)).toBe("abc123");
  });

  test("returns input unchanged for non-URL strings", () => {
    expect(parseSpreadsheetId("random-text")).toBe("random-text");
  });
});
