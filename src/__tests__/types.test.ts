import { describe, expect, test } from "bun:test";
import { DEFAULT_SPREADSHEET_ID, parseSpreadsheetId } from "../types";

const SHEETS_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

describe("types", () => {
  test("DEFAULT_SPREADSHEET_ID is defined", () => {
    expect(DEFAULT_SPREADSHEET_ID).toBe(
      "1-831oQ6kGZmaTNnVBaeG3nUiBoF-dGwsJbjJzq4N93M"
    );
  });

  test("DEFAULT_SPREADSHEET_ID is a valid Google Sheets ID format", () => {
    // Google Sheets IDs are alphanumeric with hyphens and underscores
    expect(DEFAULT_SPREADSHEET_ID).toMatch(SHEETS_ID_REGEX);
  });
});

describe("parseSpreadsheetId", () => {
  test("returns ID as-is when given plain ID", () => {
    const id = "1-831oQ6kGZmaTNnVBaeG3nUiBoF-dGwsJbjJzq4N93M";
    expect(parseSpreadsheetId(id)).toBe(id);
  });

  test("extracts ID from full Google Sheets URL", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/1-831oQ6kGZmaTNnVBaeG3nUiBoF-dGwsJbjJzq4N93M/edit#gid=0";
    expect(parseSpreadsheetId(url)).toBe(
      "1-831oQ6kGZmaTNnVBaeG3nUiBoF-dGwsJbjJzq4N93M"
    );
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
