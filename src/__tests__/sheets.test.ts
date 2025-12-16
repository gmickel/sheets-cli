import { describe, expect, mock, test } from "bun:test";
import { normalizeHeader } from "../sheets";

const MULTIPLE_ROWS_REGEX = /Multiple rows/;
const NOT_FOUND_REGEX = /not found/;

// Mock sheets client factory
function createMockSheets(
  overrides: {
    getValues?: unknown[][];
    appendResult?: { updatedRange: string; updatedRows: number };
    batchUpdateResult?: { totalUpdatedCells: number };
    spreadsheetMeta?: {
      sheets: Array<{
        properties: { title: string; sheetId: number; index: number };
      }>;
    };
  } = {}
) {
  return {
    spreadsheets: {
      get: mock(() =>
        Promise.resolve({
          data: overrides.spreadsheetMeta ?? {
            sheets: [
              { properties: { title: "Sheet1", sheetId: 0, index: 0 } },
              { properties: { title: "Projects", sheetId: 123, index: 1 } },
            ],
          },
        })
      ),
      values: {
        get: mock(() =>
          Promise.resolve({
            data: { values: overrides.getValues ?? [] },
          })
        ),
        append: mock(() =>
          Promise.resolve({
            data: {
              updates: overrides.appendResult ?? {
                updatedRange: "Sheet1!A2:C2",
                updatedRows: 1,
              },
            },
          })
        ),
        update: mock(() =>
          Promise.resolve({
            data: {
              updatedRange: "Sheet1!A1:B2",
              updatedCells: 4,
            },
          })
        ),
        batchUpdate: mock(() =>
          Promise.resolve({
            data: overrides.batchUpdateResult ?? { totalUpdatedCells: 2 },
          })
        ),
      },
    },
  };
}

describe("sheets", () => {
  describe("normalizeHeader", () => {
    test("trims whitespace", () => {
      expect(normalizeHeader("  Name  ")).toBe("name");
    });

    test("collapses multiple spaces", () => {
      expect(normalizeHeader("Project   Name")).toBe("project name");
    });

    test("converts to lowercase", () => {
      expect(normalizeHeader("PROJECT NAME")).toBe("project name");
    });

    test("handles mixed case and spacing", () => {
      expect(normalizeHeader("  PoRtCo   NaMe  ")).toBe("portco name");
    });

    test("handles empty string", () => {
      expect(normalizeHeader("")).toBe("");
    });

    test("handles single word", () => {
      expect(normalizeHeader("Status")).toBe("status");
    });
  });
});

describe("sheets API functions", () => {
  describe("listSheets", async () => {
    const { listSheets } = await import("../sheets");

    test("returns list of sheets with metadata", async () => {
      const mockSheets = createMockSheets();
      const result = await listSheets(mockSheets as never, "spreadsheet-id");

      expect(result).toEqual([
        { name: "Sheet1", sheetId: 0, index: 0 },
        { name: "Projects", sheetId: 123, index: 1 },
      ]);
    });

    test("returns empty array for spreadsheet with no sheets", async () => {
      const mockSheets = createMockSheets({ spreadsheetMeta: { sheets: [] } });
      const result = await listSheets(mockSheets as never, "spreadsheet-id");

      expect(result).toEqual([]);
    });
  });

  describe("getSheetByGid", async () => {
    const { getSheetByGid } = await import("../sheets");

    test("finds sheet by gid", async () => {
      const mockSheets = createMockSheets();
      const result = await getSheetByGid(
        mockSheets as never,
        "spreadsheet-id",
        123
      );

      expect(result?.name).toBe("Projects");
      expect(result?.sheetId).toBe(123);
    });

    test("returns null for non-existent gid", async () => {
      const mockSheets = createMockSheets();
      const result = await getSheetByGid(
        mockSheets as never,
        "spreadsheet-id",
        999
      );

      expect(result).toBeNull();
    });
  });

  describe("getHeaderRow", async () => {
    const { getHeaderRow } = await import("../sheets");

    test("returns header row values", async () => {
      const mockSheets = createMockSheets({
        getValues: [["Name", "Status", "Date"]],
      });
      const result = await getHeaderRow(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        1
      );

      expect(result).toEqual({
        headers: ["Name", "Status", "Date"],
        headerRow: 1,
      });
    });

    test("returns empty array for empty sheet", async () => {
      const mockSheets = createMockSheets({ getValues: [] });
      const result = await getHeaderRow(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        1
      );

      expect(result).toEqual({ headers: [], headerRow: 1 });
    });
  });

  describe("readTableData", async () => {
    const { readTableData } = await import("../sheets");

    test("returns headers and rows as objects", async () => {
      const mockSheets = createMockSheets();

      // Mock two calls: first for headers, second for data
      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({ data: { values: [["Name", "Status"]] } });
        }
        return Promise.resolve({
          data: {
            values: [
              ["Alice", "Active"],
              ["Bob", "Inactive"],
            ],
          },
        });
      });

      const result = await readTableData(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        { headerRow: 1 }
      );

      expect(result.headers).toEqual(["Name", "Status"]);
      expect(result.rows).toEqual([
        { Name: "Alice", Status: "Active" },
        { Name: "Bob", Status: "Inactive" },
      ]);
    });

    test("respects limit option", async () => {
      const mockSheets = createMockSheets();

      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({ data: { values: [["Name"]] } });
        }
        return Promise.resolve({
          data: { values: [["A"], ["B"], ["C"], ["D"]] },
        });
      });

      const result = await readTableData(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        {
          limit: 2,
        }
      );

      expect(result.rows).toHaveLength(2);
    });
  });

  describe("readRange", async () => {
    const { readRange } = await import("../sheets");

    test("returns raw values from range", async () => {
      const mockSheets = createMockSheets({
        getValues: [
          ["A1", "B1"],
          ["A2", "B2"],
        ],
      });

      const result = await readRange(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1!A1:B2"
      );

      expect(result).toEqual([
        ["A1", "B1"],
        ["A2", "B2"],
      ]);
    });
  });

  describe("appendRows", async () => {
    const { appendRows } = await import("../sheets");

    test("appends row with column mapping", async () => {
      const mockSheets = createMockSheets();

      let _callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        _callCount += 1;
        return Promise.resolve({ data: { values: [["Name", "Status"]] } });
      });

      const result = await appendRows(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        { Name: "Test", Status: "Active" },
        {}
      );

      expect(result.updatedRows).toBe(1);
      expect(result.dryRun).toBe(false);
    });

    test("returns preview in dry-run mode", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name", "Status"]] } })
      );

      const result = await appendRows(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        { Name: "Test" },
        { dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      expect(mockSheets.spreadsheets.values.append).not.toHaveBeenCalled();
    });
  });

  describe("updateByRowIndex", async () => {
    const { updateByRowIndex } = await import("../sheets");

    test("updates cells at specified row", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name", "Status"]] } })
      );

      const result = await updateByRowIndex(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        5,
        { Status: "Done" },
        {}
      );

      expect(result.updatedCells).toBe(1);
      expect(result.dryRun).toBe(false);
      expect(mockSheets.spreadsheets.values.batchUpdate).toHaveBeenCalled();
    });

    test("skips unknown columns", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name", "Status"]] } })
      );

      const result = await updateByRowIndex(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        5,
        { UnknownColumn: "value" },
        {}
      );

      expect(result.updatedCells).toBe(0);
    });
  });

  describe("updateByKey", async () => {
    const { updateByKey } = await import("../sheets");

    test("finds and updates row by key column", async () => {
      const mockSheets = createMockSheets();

      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          // Headers
          return Promise.resolve({ data: { values: [["Name", "Status"]] } });
        }
        // Key column values
        return Promise.resolve({
          data: { values: [["Name"], ["Alice"], ["Bob"], ["Charlie"]] },
        });
      });

      const result = await updateByKey(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        "Name",
        "Bob",
        { Status: "Updated" },
        { headerRow: 1 }
      );

      expect(result.matchedRows).toBe(1);
      expect(result.updatedCells).toBe(1);
    });

    test("returns zero matches for non-existent key", async () => {
      const mockSheets = createMockSheets();

      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({ data: { values: [["Name", "Status"]] } });
        }
        return Promise.resolve({
          data: { values: [["Name"], ["Alice"], ["Bob"]] },
        });
      });

      const result = await updateByKey(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        "Name",
        "NonExistent",
        { Status: "X" },
        {}
      );

      expect(result.matchedRows).toBe(0);
      expect(result.updatedCells).toBe(0);
    });

    test("throws error on multiple matches without allowMulti", async () => {
      const mockSheets = createMockSheets();

      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({ data: { values: [["Name", "Status"]] } });
        }
        return Promise.resolve({
          data: { values: [["Name"], ["Alice"], ["Alice"]] },
        });
      });

      await expect(
        updateByKey(
          mockSheets as never,
          "spreadsheet-id",
          "Sheet1",
          "Name",
          "Alice",
          { Status: "X" },
          {}
        )
      ).rejects.toThrow(MULTIPLE_ROWS_REGEX);
    });

    test("updates multiple rows with allowMulti", async () => {
      const mockSheets = createMockSheets();

      let callCount = 0;
      mockSheets.spreadsheets.values.get = mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({ data: { values: [["Name", "Status"]] } });
        }
        return Promise.resolve({
          data: { values: [["Name"], ["Alice"], ["Alice"]] },
        });
      });

      const result = await updateByKey(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1",
        "Name",
        "Alice",
        { Status: "Both" },
        { allowMulti: true, headerRow: 1 }
      );

      expect(result.matchedRows).toBe(2);
      expect(result.updatedCells).toBe(2);
    });

    test("throws error for non-existent key column", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name", "Status"]] } })
      );

      await expect(
        updateByKey(
          mockSheets as never,
          "spreadsheet-id",
          "Sheet1",
          "NonExistentCol",
          "value",
          { Status: "X" },
          {}
        )
      ).rejects.toThrow(NOT_FOUND_REGEX);
    });
  });

  describe("setRange", async () => {
    const { setRange } = await import("../sheets");

    test("sets values in range", async () => {
      const mockSheets = createMockSheets();

      const result = await setRange(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1!A1:B2",
        [
          ["a", "b"],
          ["c", "d"],
        ],
        {}
      );

      expect(result.updatedCells).toBe(4);
      expect(result.dryRun).toBe(false);
    });

    test("returns preview in dry-run mode", async () => {
      const mockSheets = createMockSheets();

      const result = await setRange(
        mockSheets as never,
        "spreadsheet-id",
        "Sheet1!A1:B2",
        [
          ["a", "b"],
          ["c", "d"],
        ],
        { dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      expect(result.updatedCells).toBe(4);
      expect(mockSheets.spreadsheets.values.update).not.toHaveBeenCalled();
    });
  });

  describe("batchOperations", async () => {
    const { batchOperations } = await import("../sheets");

    test("executes multiple operations", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name", "Status"]] } })
      );

      const result = await batchOperations(
        mockSheets as never,
        "spreadsheet-id",
        [
          { op: "append", sheet: "Sheet1", values: { Name: "Test" } },
          { op: "setRange", range: "Sheet1!A1", values: [["Updated"]] },
        ],
        {}
      );

      expect(result.results).toHaveLength(2);
      expect(result.dryRun).toBe(false);
    });

    test("respects dry-run for all operations", async () => {
      const mockSheets = createMockSheets();

      mockSheets.spreadsheets.values.get = mock(() =>
        Promise.resolve({ data: { values: [["Name"]] } })
      );

      const result = await batchOperations(
        mockSheets as never,
        "spreadsheet-id",
        [{ op: "append", sheet: "Sheet1", values: { Name: "Test" } }],
        { dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      expect(mockSheets.spreadsheets.values.append).not.toHaveBeenCalled();
    });
  });
});
