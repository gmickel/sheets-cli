import { describe, expect, test } from "bun:test";
import { error, exitCode, success } from "../output";

describe("output", () => {
  describe("success", () => {
    test("creates success result with minimal options", () => {
      const result = success("test cmd", { data: "value" });

      expect(result).toEqual({
        ok: true,
        cmd: "test cmd",
        result: { data: "value" },
      });
    });

    test("includes spreadsheetId when provided", () => {
      const result = success(
        "read table",
        { rows: [] },
        { spreadsheetId: "abc123" }
      );

      expect(result).toEqual({
        ok: true,
        cmd: "read table",
        spreadsheetId: "abc123",
        result: { rows: [] },
      });
    });

    test("includes sheet when provided", () => {
      const result = success("append", { updated: 1 }, { sheet: "Sheet1" });

      expect(result).toEqual({
        ok: true,
        cmd: "append",
        sheet: "Sheet1",
        result: { updated: 1 },
      });
    });

    test("includes both spreadsheetId and sheet when provided", () => {
      const result = success(
        "update row",
        { cells: 3 },
        { spreadsheetId: "xyz789", sheet: "Projects" }
      );

      expect(result).toEqual({
        ok: true,
        cmd: "update row",
        spreadsheetId: "xyz789",
        sheet: "Projects",
        result: { cells: 3 },
      });
    });
  });

  describe("error", () => {
    test("creates error result without details", () => {
      const result = error("batch", "VALIDATION_ERROR", "Invalid JSON");

      expect(result).toEqual({
        ok: false,
        cmd: "batch",
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid JSON",
        },
      });
    });

    test("creates error result with details", () => {
      const result = error("update key", "API_ERROR", "Rate limited", {
        retryAfter: 60,
      });

      expect(result).toEqual({
        ok: false,
        cmd: "update key",
        error: {
          code: "API_ERROR",
          message: "Rate limited",
          details: { retryAfter: 60 },
        },
      });
    });

    test("handles all error codes", () => {
      const codes = [
        "VALIDATION_ERROR",
        "AUTH_ERROR",
        "PERMISSION_ERROR",
        "API_ERROR",
      ] as const;

      for (const code of codes) {
        const result = error("test", code, "test message");
        expect(result.error.code).toBe(code);
      }
    });
  });

  describe("exitCode", () => {
    test("returns 0 for success", () => {
      const result = success("cmd", {});
      expect(exitCode(result)).toBe(0);
    });

    test("returns 10 for VALIDATION_ERROR", () => {
      const result = error("cmd", "VALIDATION_ERROR", "msg");
      expect(exitCode(result)).toBe(10);
    });

    test("returns 20 for AUTH_ERROR", () => {
      const result = error("cmd", "AUTH_ERROR", "msg");
      expect(exitCode(result)).toBe(20);
    });

    test("returns 30 for PERMISSION_ERROR", () => {
      const result = error("cmd", "PERMISSION_ERROR", "msg");
      expect(exitCode(result)).toBe(30);
    });

    test("returns 40 for API_ERROR", () => {
      const result = error("cmd", "API_ERROR", "msg");
      expect(exitCode(result)).toBe(40);
    });
  });
});
