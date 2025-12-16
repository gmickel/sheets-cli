import type { OAuth2Client } from "google-auth-library";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";
import type { BatchOperation, ValueInputOption } from "./types";

export function getSheetsClient(auth: OAuth2Client): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth });
}

export function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toLowerCase();
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

// Auto-detect header row by finding first non-empty row
async function detectHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  maxScan = 10
): Promise<number> {
  const range = `'${sheetName}'!1:${maxScan}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].length > 0 && rows[i].some((cell) => cell !== "")) {
      return i + 1; // 1-indexed
    }
  }
  return 1; // Default to row 1
}

export async function getHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  headerRow?: number
): Promise<{ headers: string[]; headerRow: number }> {
  const actualRow =
    headerRow ?? (await detectHeaderRow(sheets, spreadsheetId, sheetName));
  const range = `'${sheetName}'!${actualRow}:${actualRow}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return {
    headers: (res.data.values?.[0] as string[]) ?? [],
    headerRow: actualRow,
  };
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
  const { headers, headerRow } = await getHeaderRow(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  // Return empty if no headers
  if (headers.length === 0) {
    return { headers: [], rows: [], headerRow };
  }

  const dataRange =
    opts.range ??
    `'${sheetName}'!A${headerRow + 1}:${colToLetter(headers.length)}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: dataRange,
    valueRenderOption: opts.raw ? "UNFORMATTED_VALUE" : "FORMATTED_VALUE",
  });

  const rawRows = res.data.values ?? [];
  const limitedRows = opts.limit ? rawRows.slice(0, opts.limit) : rawRows;

  const rows = limitedRows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const [i, header] of headers.entries()) {
      obj[header] = row[i] ?? null;
    }
    return obj;
  });

  return { headers, rows, headerRow };
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
  const { headers, headerRow } = await getHeaderRow(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  const row = headers.map((h) => {
    const normalizedH = normalizeHeader(h);
    for (const [key, val] of Object.entries(values)) {
      if (normalizeHeader(key) === normalizedH) {
        return val ?? "";
      }
    }
    return "";
  });

  if (opts.dryRun) {
    return {
      updatedRange: `'${sheetName}'!A${headerRow + 1}`,
      updatedRows: 1,
      dryRun: true,
    };
  }

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A${headerRow}`,
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
  const { headers } = await getHeaderRow(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  const updates: { range: string; values: unknown[][] }[] = [];

  for (const [key, val] of Object.entries(setValues)) {
    const normalizedKey = normalizeHeader(key);
    const colIdx = headers.findIndex(
      (h) => normalizeHeader(h) === normalizedKey
    );
    if (colIdx === -1) {
      continue;
    }

    const colLetter = colToLetter(colIdx + 1);
    const range = `'${sheetName}'!${colLetter}${rowIndex}`;
    updates.push({ range, values: [[val]] });
  }

  if (opts.dryRun) {
    return {
      updatedCells: updates.length,
      updatedRange: updates.map((u) => u.range).join(", "),
      dryRun: true,
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
  const { headers, headerRow } = await getHeaderRow(
    sheets,
    spreadsheetId,
    sheetName,
    opts.headerRow
  );

  const normalizedKeyCol = normalizeHeader(keyCol);
  const keyColIdx = headers.findIndex(
    (h) => normalizeHeader(h) === normalizedKeyCol
  );
  if (keyColIdx === -1) {
    throw new Error(`Key column "${keyCol}" not found`);
  }

  // Read the key column to find matching rows
  const keyColLetter = colToLetter(keyColIdx + 1);
  const keyRange = `'${sheetName}'!${keyColLetter}:${keyColLetter}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: keyRange,
  });

  const keyValues = res.data.values ?? [];
  const matchingRows: number[] = [];

  for (let i = headerRow; i < keyValues.length; i++) {
    if (String(keyValues[i]?.[0] ?? "").trim() === keyValue.trim()) {
      matchingRows.push(i + 1); // 1-indexed row number
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
      const normalizedKey = normalizeHeader(key);
      const colIdx = headers.findIndex(
        (h) => normalizeHeader(h) === normalizedKey
      );
      if (colIdx === -1) {
        continue;
      }

      const colLetter = colToLetter(colIdx + 1);
      const range = `'${sheetName}'!${colLetter}${rowNum}`;
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
