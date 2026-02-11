import type { OAuth2Client } from "google-auth-library";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";
import type { BatchOperation, ValueInputOption } from "./types";

const COLUMN_LETTER_REGEX = /^[A-Za-z]{1,3}$/;
const A1_START_REGEX = /^([A-Za-z]+)?(\d+)?$/;
const NUMBERISH_REGEX = /^-?\d+(\.\d+)?$/;
const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}/;
const DATE_SLASH_REGEX = /^\d{1,2}\/\d{1,2}\/\d{2,4}/;
const HAS_ALPHA_REGEX = /[A-Za-z]/;

export function getSheetsClient(auth: OAuth2Client): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth });
}

export function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toLowerCase();
}

type A1Start = {
  col?: number;
  row?: number;
};

type TableLayout = {
  hasHeader: boolean;
  headerRow: number; // 0 when no header
  dataStartRow: number;
  startCol: number;
  width: number;
  headers: string[];
  rawHeaders: string[]; // only when hasHeader; else []
};

function escapeSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

function qualifyRange(sheetName: string, range: string): string {
  if (range.includes("!")) {
    return range;
  }
  return `${escapeSheetName(sheetName)}!${range}`;
}

function isColumnLetter(input: string): boolean {
  return COLUMN_LETTER_REGEX.test(input.trim());
}

function colLetterToNumber(letter: string): number {
  const s = letter.trim().toUpperCase();
  let n = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) {
      return Number.NaN;
    }
    n = n * 26 + (code - 64);
  }
  return n;
}

function parseA1Start(range: string | null | undefined): A1Start {
  if (!range) {
    return {};
  }
  const parts = range.split("!");
  const a1 = (parts[1] ?? parts[0] ?? "").split(":")[0] ?? "";
  const match = a1.match(A1_START_REGEX);
  if (!match) {
    return {};
  }
  const col = match[1] ? colLetterToNumber(match[1]) : undefined;
  const row = match[2] ? Number.parseInt(match[2], 10) : undefined;
  return {
    col: Number.isFinite(col ?? Number.NaN) ? col : undefined,
    row: Number.isFinite(row ?? Number.NaN) ? row : undefined,
  };
}

function stringifyCell(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return "";
  }
  return String(cell);
}

function isNonEmptyCell(cell: unknown): boolean {
  return stringifyCell(cell).trim() !== "";
}

function inferHasHeader(sampleRows: unknown[][]): boolean {
  const first = sampleRows[0] ?? [];
  const nonEmptyCells = first
    .filter(isNonEmptyCell)
    .map((c) => stringifyCell(c).trim());
  const nonEmpty = nonEmptyCells.length;
  if (nonEmpty === 0) {
    return false;
  }

  if (nonEmpty === 1) {
    const v = nonEmptyCells[0] ?? "";
    if (!v) {
      return false;
    }
    const looksNumeric = NUMBERISH_REGEX.test(v);
    const looksDate = DATE_ISO_REGEX.test(v) || DATE_SLASH_REGEX.test(v);
    const hasAlpha = HAS_ALPHA_REGEX.test(v);
    return hasAlpha && !looksNumeric && !looksDate;
  }

  const normalized = nonEmptyCells.map((c) => normalizeHeader(c));
  const uniqueRatio = new Set(normalized).size / nonEmpty;

  let alpha = 0;
  let numericLike = 0;
  let dateLike = 0;
  for (const v of nonEmptyCells) {
    if (HAS_ALPHA_REGEX.test(v)) {
      alpha += 1;
    }
    if (NUMBERISH_REGEX.test(v)) {
      numericLike += 1;
    }
    if (DATE_ISO_REGEX.test(v) || DATE_SLASH_REGEX.test(v)) {
      dateLike += 1;
    }
  }

  const alphaRatio = alpha / nonEmpty;
  const numberishRatio = (numericLike + dateLike) / nonEmpty;

  return uniqueRatio >= 0.8 && alphaRatio >= 0.5 && numberishRatio <= 0.5;
}

function buildHeaders(
  rawRow: unknown[],
  startCol: number,
  width: number
): { headers: string[]; rawHeaders: string[] } {
  const rawHeaders: string[] = [];
  for (let i = 0; i < width; i += 1) {
    rawHeaders.push(stringifyCell(rawRow[i]).trim());
  }

  const used = new Map<string, number>();
  const headers: string[] = [];

  for (let i = 0; i < width; i += 1) {
    const raw = rawHeaders[i] ?? "";
    const base = raw === "" ? colToLetter(startCol + i) : raw;
    const norm = normalizeHeader(base);
    const seen = used.get(norm) ?? 0;
    used.set(norm, seen + 1);
    headers.push(seen === 0 ? base : `${base}_${seen + 1}`);
  }

  return { headers, rawHeaders };
}

export async function getSpreadsheetMetadata(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<sheets_v4.Schema$Spreadsheet> {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  return res.data;
}

export async function listSheets(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string
): Promise<{ name: string; sheetId: number; index: number }[]> {
  const meta = await getSpreadsheetMetadata(sheets, spreadsheetId);
  return (
    meta.sheets?.map((s) => ({
      name: s.properties?.title ?? "",
      sheetId: s.properties?.sheetId ?? 0,
      index: s.properties?.index ?? 0,
    })) ?? []
  );
}

export async function getSheetByGid(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  gid: number
): Promise<{ name: string; sheetId: number } | null> {
  const list = await listSheets(sheets, spreadsheetId);
  return list.find((s) => s.sheetId === gid) ?? null;
}

async function getTableLayout(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerRow: number | undefined
): Promise<TableLayout> {
  const quotedSheet = escapeSheetName(sheetName);

  if (headerRow !== undefined) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedSheet}!${headerRow}:${headerRow}`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const start = parseA1Start(res.data.range);
    const startCol = start.col ?? 1;
    const rowValues = res.data.values?.[0] ?? [];
    const width = rowValues.length;
    const { headers, rawHeaders } = buildHeaders(rowValues, startCol, width);
    return {
      hasHeader: true,
      headerRow,
      dataStartRow: headerRow + 1,
      startCol,
      width,
      headers,
      rawHeaders,
    };
  }

  const scanSteps = [20, 50, 100, 200];
  for (const scanRows of scanSteps) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quotedSheet}!1:${scanRows}`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = res.data.values ?? [];
    if (rows.length === 0) {
      continue;
    }

    const start = parseA1Start(res.data.range);
    const baseRow = start.row ?? 1;
    const startCol = start.col ?? 1;

    let firstNonEmptyIdx = -1;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      if (row.some(isNonEmptyCell)) {
        firstNonEmptyIdx = i;
        break;
      }
    }
    if (firstNonEmptyIdx === -1) {
      continue;
    }

    const slice = rows.slice(firstNonEmptyIdx, firstNonEmptyIdx + 5);
    const width = slice.reduce((max, r) => Math.max(max, (r ?? []).length), 0);
    const dataRow = baseRow + firstNonEmptyIdx;
    const hasHeader = inferHasHeader(slice);

    if (width === 0) {
      return {
        hasHeader: false,
        headerRow: 0,
        dataStartRow: dataRow,
        startCol,
        width: 0,
        headers: [],
        rawHeaders: [],
      };
    }

    if (hasHeader) {
      const { headers, rawHeaders } = buildHeaders(
        rows[firstNonEmptyIdx] ?? [],
        startCol,
        width
      );
      return {
        hasHeader: true,
        headerRow: dataRow,
        dataStartRow: dataRow + 1,
        startCol,
        width,
        headers,
        rawHeaders,
      };
    }

    const generatedHeaders = Array.from({ length: width }, (_, i) =>
      colToLetter(startCol + i)
    );
    return {
      hasHeader: false,
      headerRow: 0,
      dataStartRow: dataRow,
      startCol,
      width,
      headers: generatedHeaders,
      rawHeaders: [],
    };
  }

  return {
    hasHeader: false,
    headerRow: 0,
    dataStartRow: 1,
    startCol: 1,
    width: 0,
    headers: [],
    rawHeaders: [],
  };
}

export async function getHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerRow?: number
): Promise<{ headers: string[]; headerRow: number }> {
  const layout = await getTableLayout(
    sheets,
    spreadsheetId,
    sheetName,
    headerRow
  );
  return { headers: layout.headers, headerRow: layout.headerRow };
}

export async function readTableData(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  opts: { limit?: number; range?: string; headerRow?: number; raw?: boolean }
): Promise<{
  headers: string[];
  rows: Record<string, unknown>[];
  headerRow: number;
}> {
  const layout = await getTableLayout(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  if (layout.width === 0) {
    return { headers: [], rows: [], headerRow: layout.headerRow };
  }

  const quotedSheet = escapeSheetName(sheetName);
  const dataRange = opts.range
    ? qualifyRange(sheetName, opts.range)
    : `${quotedSheet}!${colToLetter(layout.startCol)}${layout.dataStartRow}:${colToLetter(
        layout.startCol + layout.width - 1
      )}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: dataRange,
    valueRenderOption: opts.raw ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
  });

  const rawRows = res.data.values ?? [];
  const limitedRows = opts.limit ? rawRows.slice(0, opts.limit) : rawRows;

  const rows = limitedRows.map((row, idx) => {
    const obj: Record<string, unknown> = {
      _row: layout.dataStartRow + idx,
    };
    for (let i = 0; i < layout.width; i += 1) {
      const header = layout.headers[i] ?? colToLetter(layout.startCol + i);
      obj[header] = row?.[i] ?? null;
    }
    return obj;
  });

  return {
    headers: ["_row", ...layout.headers],
    rows,
    headerRow: layout.headerRow,
  };
}

export async function readRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string
): Promise<unknown[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return res.data.values ?? [];
}

export async function appendRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  values: Record<string, unknown>,
  opts: {
    valueInputOption?: ValueInputOption;
    dryRun?: boolean;
    headerRow?: number;
  }
): Promise<{ updatedRange: string; updatedRows: number; dryRun: boolean }> {
  const quotedSheet = escapeSheetName(sheetName);
  const layout = await getTableLayout(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  const normalizedKeyToValue = new Map<string, unknown>();
  const colNumberToValue = new Map<number, unknown>();
  const headerNorms = layout.hasHeader
    ? new Set(layout.rawHeaders.map((h) => normalizeHeader(h)))
    : null;
  for (const [key, val] of Object.entries(values)) {
    normalizedKeyToValue.set(normalizeHeader(key), val);
    if (isColumnLetter(key) && !headerNorms?.has(normalizeHeader(key))) {
      const colNum = colLetterToNumber(key);
      if (Number.isFinite(colNum)) {
        colNumberToValue.set(colNum, val);
      }
    }
  }

  const sheetIsEmpty = layout.width === 0;
  if (sheetIsEmpty && Object.keys(values).length > 0) {
    const rawHeaders = Object.keys(values);
    const width = rawHeaders.length;
    const { headers } = buildHeaders(rawHeaders, 1, width);
    const row = rawHeaders.map(
      (h) => normalizedKeyToValue.get(normalizeHeader(h)) ?? ""
    );

    if (opts.dryRun) {
      return {
        updatedRange: `${quotedSheet}!A1`,
        updatedRows: 2,
        dryRun: true,
      };
    }

    const res = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${quotedSheet}!A1`,
      valueInputOption: opts.valueInputOption ?? "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [headers, row] },
    });

    return {
      updatedRange: res.data.updates?.updatedRange ?? "",
      updatedRows: res.data.updates?.updatedRows ?? 0,
      dryRun: false,
    };
  }

  const baseWidth = layout.width;
  const maxColFromInput = [...colNumberToValue.keys()].reduce(
    (m, c) => Math.max(m, c),
    0
  );
  const targetWidth =
    maxColFromInput > 0
      ? Math.max(baseWidth, maxColFromInput - layout.startCol + 1)
      : baseWidth;

  const row: unknown[] = [];
  for (let i = 0; i < targetWidth; i += 1) {
    const colNum = layout.startCol + i;
    const byCol = colNumberToValue.get(colNum);
    if (byCol !== undefined) {
      row.push(byCol);
      continue;
    }

    if (!layout.hasHeader) {
      row.push("");
      continue;
    }

    const rawHeader = layout.rawHeaders[i] ?? "";
    const direct = normalizedKeyToValue.get(normalizeHeader(rawHeader));
    if (direct !== undefined) {
      row.push(direct);
      continue;
    }

    const viaDisplay = normalizedKeyToValue.get(
      normalizeHeader(layout.headers[i] ?? "")
    );
    row.push(viaDisplay ?? "");
  }

  if (opts.dryRun) {
    return {
      updatedRange: `${quotedSheet}!${colToLetter(layout.startCol)}${layout.dataStartRow}`,
      updatedRows: 1,
      dryRun: true,
    };
  }

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quotedSheet}!${colToLetter(layout.startCol)}${
      layout.hasHeader ? layout.headerRow : layout.dataStartRow
    }`,
    valueInputOption: opts.valueInputOption ?? "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return {
    updatedRange: res.data.updates?.updatedRange ?? "",
    updatedRows: res.data.updates?.updatedRows ?? 0,
    dryRun: false,
  };
}

export async function updateByRowIndex(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  setValues: Record<string, unknown>,
  opts: {
    valueInputOption?: ValueInputOption;
    dryRun?: boolean;
    headerRow?: number;
  }
): Promise<{ updatedCells: number; updatedRange: string; dryRun: boolean }> {
  if (!Number.isFinite(rowIndex) || rowIndex < 1) {
    throw new Error("Row index must be a positive integer");
  }

  const quotedSheet = escapeSheetName(sheetName);
  const layout = await getTableLayout(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  const updates: { range: string; values: unknown[][] }[] = [];

  for (const [key, val] of Object.entries(setValues)) {
    let colNum: number | null = null;
    if (layout.hasHeader) {
      const normalizedKey = normalizeHeader(key);
      const colIdx = layout.rawHeaders.findIndex(
        (h) => normalizeHeader(h) === normalizedKey
      );
      colNum = colIdx === -1 ? null : layout.startCol + colIdx;
    }
    if (colNum === null && isColumnLetter(key)) {
      const parsed = colLetterToNumber(key);
      colNum = Number.isFinite(parsed) ? parsed : null;
    }

    if (!colNum) {
      continue;
    }

    const range = `${quotedSheet}!${colToLetter(colNum)}${rowIndex}`;
    updates.push({ range, values: [[val]] });
  }

  if (opts.dryRun) {
    return {
      updatedCells: updates.length,
      updatedRange: updates.map((u) => u.range).join(", "),
      dryRun: true,
    };
  }

  if (updates.length === 0) {
    return { updatedCells: 0, updatedRange: "", dryRun: false };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: opts.valueInputOption ?? "USER_ENTERED",
      data: updates,
    },
  });

  return {
    updatedCells: updates.length,
    updatedRange: updates.map((u) => u.range).join(", "),
    dryRun: false,
  };
}

export async function updateByKey(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  keyCol: string,
  keyValue: string,
  setValues: Record<string, unknown>,
  opts: {
    valueInputOption?: ValueInputOption;
    dryRun?: boolean;
    headerRow?: number;
    allowMulti?: boolean;
  }
): Promise<{
  matchedRows: number;
  updatedCells: number;
  updatedRanges: string[];
  dryRun: boolean;
}> {
  const quotedSheet = escapeSheetName(sheetName);
  const layout = await getTableLayout(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  let keyColNum: number | null = null;
  if (layout.hasHeader) {
    const normalizedKeyCol = normalizeHeader(keyCol);
    const keyColIdx = layout.rawHeaders.findIndex(
      (h) => normalizeHeader(h) === normalizedKeyCol
    );
    keyColNum = keyColIdx === -1 ? null : layout.startCol + keyColIdx;
  }
  if (keyColNum === null && isColumnLetter(keyCol)) {
    const parsed = colLetterToNumber(keyCol);
    keyColNum = Number.isFinite(parsed) ? parsed : null;
  }

  if (!keyColNum) {
    throw new Error(`Key column "${keyCol}" not found`);
  }

  // Read the key column to find matching rows
  const keyColLetter = colToLetter(keyColNum);
  const keyRange = `${quotedSheet}!${keyColLetter}${layout.dataStartRow}:${keyColLetter}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: keyRange,
  });

  const keyValues = res.data.values ?? [];
  const matchingRows: number[] = [];

  const startRow = parseA1Start(res.data.range).row ?? layout.dataStartRow;
  const targetKey = keyValue.trim();
  for (let i = 0; i < keyValues.length; i += 1) {
    if (stringifyCell(keyValues[i]?.[0]).trim() === targetKey) {
      matchingRows.push(startRow + i);
    }
  }

  if (matchingRows.length === 0) {
    return {
      matchedRows: 0,
      updatedCells: 0,
      updatedRanges: [],
      dryRun: opts.dryRun ?? false,
    };
  }

  if (matchingRows.length > 1 && !opts.allowMulti) {
    throw new Error(
      `Multiple rows (${matchingRows.length}) match key "${keyValue}". Use --allow-multi to update all.`
    );
  }

  const updates: { range: string; values: unknown[][] }[] = [];

  for (const rowNum of matchingRows) {
    for (const [key, val] of Object.entries(setValues)) {
      let colNum: number | null = null;
      if (layout.hasHeader) {
        const normalizedKey = normalizeHeader(key);
        const colIdx = layout.rawHeaders.findIndex(
          (h) => normalizeHeader(h) === normalizedKey
        );
        colNum = colIdx === -1 ? null : layout.startCol + colIdx;
      }
      if (colNum === null && isColumnLetter(key)) {
        const parsed = colLetterToNumber(key);
        colNum = Number.isFinite(parsed) ? parsed : null;
      }

      if (!colNum) {
        continue;
      }

      const range = `${quotedSheet}!${colToLetter(colNum)}${rowNum}`;
      updates.push({ range, values: [[val]] });
    }
  }

  if (opts.dryRun) {
    return {
      matchedRows: matchingRows.length,
      updatedCells: updates.length,
      updatedRanges: updates.map((u) => u.range),
      dryRun: true,
    };
  }

  if (updates.length === 0) {
    return {
      matchedRows: matchingRows.length,
      updatedCells: 0,
      updatedRanges: [],
      dryRun: false,
    };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: opts.valueInputOption ?? "USER_ENTERED",
      data: updates,
    },
  });

  return {
    matchedRows: matchingRows.length,
    updatedCells: updates.length,
    updatedRanges: updates.map((u) => u.range),
    dryRun: false,
  };
}

export async function setRange(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  opts: { valueInputOption?: ValueInputOption; dryRun?: boolean }
): Promise<{ updatedRange: string; updatedCells: number; dryRun: boolean }> {
  if (opts.dryRun) {
    return {
      updatedRange: range,
      updatedCells: values.reduce((acc, row) => acc + row.length, 0),
      dryRun: true,
    };
  }

  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: opts.valueInputOption ?? "USER_ENTERED",
    requestBody: { values },
  });

  return {
    updatedRange: res.data.updatedRange ?? range,
    updatedCells: res.data.updatedCells ?? 0,
    dryRun: false,
  };
}

export async function batchOperations(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  operations: BatchOperation[],
  opts: { valueInputOption?: ValueInputOption; dryRun?: boolean }
): Promise<{ results: unknown[]; dryRun: boolean }> {
  const results: unknown[] = [];

  for (const op of operations) {
    switch (op.op) {
      case "append": {
        const res = await appendRows(
          sheets,
          spreadsheetId,
          op.sheet,
          op.values,
          opts
        );
        results.push({ op: "append", sheet: op.sheet, ...res });
        break;
      }
      case "updateRow": {
        const res = await updateByRowIndex(
          sheets,
          spreadsheetId,
          op.sheet,
          op.row,
          op.set,
          opts
        );
        results.push({ op: "updateRow", sheet: op.sheet, row: op.row, ...res });
        break;
      }
      case "updateKey": {
        const res = await updateByKey(
          sheets,
          spreadsheetId,
          op.sheet,
          op.keyCol,
          op.key,
          op.set,
          { ...opts, allowMulti: op.allowMulti }
        );
        results.push({
          op: "updateKey",
          sheet: op.sheet,
          keyCol: op.keyCol,
          key: op.key,
          ...res,
        });
        break;
      }
      case "setRange": {
        const res = await setRange(
          sheets,
          spreadsheetId,
          op.range,
          op.values,
          opts
        );
        results.push({ op: "setRange", range: op.range, ...res });
        break;
      }
      default:
        break;
    }
  }

  return { results, dryRun: opts.dryRun ?? false };
}

function colToLetter(col: number): string {
  let result = "";
  let n = col;
  while (n > 0) {
    n -= 1;
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
