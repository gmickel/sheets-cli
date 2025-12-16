#!/usr/bin/env bun
import { Command } from "commander";
import { getAuthClient, getAuthStatus, login, logout } from "./auth";
import { error, exitCode, output, success } from "./output";
import {
  appendRows,
  batchOperations,
  getHeaderRow,
  getSheetByGid,
  getSheetsClient,
  listSheets,
  readRange,
  readTableData,
  setRange,
  updateByKey,
  updateByRowIndex,
} from "./sheets";
import { SKILL_CONTENT } from "./skill";
import type { BatchOperation, Result, ValueInputOption } from "./types";
import { DEFAULT_SPREADSHEET_ID, parseSpreadsheetId } from "./types";

const program = new Command();

// Helper to resolve spreadsheet from URL or ID
function resolveSpreadsheet(input: string): string {
  return parseSpreadsheetId(input);
}

program
  .name("sheets-cli")
  .description(
    `CLI for Google Sheets primitives

Spreadsheet ID:
  Most commands accept --spreadsheet <id> to specify the target.
  Get the ID from your sheet URL: docs.google.com/spreadsheets/d/<ID>/edit
  Default: ${DEFAULT_SPREADSHEET_ID}`
  )
  .version("1.0.0");

// Helper to get authenticated sheets client
async function getSheets(
  cmd: string
): Promise<ReturnType<typeof getSheetsClient> | null> {
  const client = await getAuthClient();
  if (!client) {
    output(
      error(
        cmd,
        "AUTH_ERROR",
        "Not authenticated. Run 'sheets-cli auth login' first."
      )
    );
    return null;
  }
  return getSheetsClient(client);
}

// Helper to handle API errors
function handleApiError(
  cmd: string,
  err: unknown,
  spreadsheetId?: string,
  sheet?: string
): Result {
  const message = err instanceof Error ? err.message : String(err);

  if (
    message.includes("invalid_grant") ||
    message.includes("Token has been expired")
  ) {
    return error(
      cmd,
      "AUTH_ERROR",
      "Token expired. Run 'sheets-cli auth login' to re-authenticate."
    );
  }
  if (message.includes("permission") || message.includes("403")) {
    return error(cmd, "PERMISSION_ERROR", message, { spreadsheetId, sheet });
  }
  return error(cmd, "API_ERROR", message, { spreadsheetId, sheet });
}

// Auth commands
const auth = program.command("auth").description("Authentication commands");

auth
  .command("login")
  .description("Authenticate with Google")
  .requiredOption("--credentials <path>", "Path to OAuth client JSON file")
  .option("--token-store <path>", "Path to store token")
  .action(async (opts) => {
    const result = await login(opts.credentials, opts.tokenStore);
    if (result.success) {
      output(success("auth login", { message: result.message }));
      process.exit(0);
    } else {
      output(error("auth login", "AUTH_ERROR", result.message));
      process.exit(20);
    }
  });

auth
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const status = await getAuthStatus();
    output(success("auth status", status));
    process.exit(0);
  });

auth
  .command("logout")
  .description("Clear stored credentials")
  .option("--token-store <path>", "Token storage path")
  .action(async (opts: { tokenStore?: string }) => {
    const result = await logout(opts.tokenStore);
    if (result.success) {
      output(success("auth logout", { message: result.message }));
      process.exit(0);
    } else {
      output(error("auth logout", "AUTH_ERROR", result.message));
      process.exit(20);
    }
  });

// Sheets metadata commands
const sheets = program.command("sheets").description("Spreadsheet metadata");

sheets
  .command("list")
  .description("List all sheets/tabs in a spreadsheet")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .action(async (opts) => {
    const cmd = "sheets list";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    try {
      const sheetsList = await listSheets(client, spreadsheetId);
      output(success(cmd, { sheets: sheetsList }, { spreadsheetId }));
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err, spreadsheetId);
      output(result);
      process.exit(exitCode(result));
    }
  });

sheets
  .command("find")
  .description("Search for spreadsheets by name (uses Drive API)")
  .requiredOption("--name <query>", "Name to search for")
  .option("--limit <n>", "Max results", "10")
  .action(async (opts) => {
    const cmd = "sheets find";
    const authClient = await getAuthClient();
    if (!authClient) {
      output(
        error(
          cmd,
          "AUTH_ERROR",
          "Not authenticated. Run 'sheets-cli auth login' first."
        )
      );
      return process.exit(20);
    }

    try {
      const { google } = await import("googleapis");
      const drive = google.drive({ version: "v3", auth: authClient });
      const limit = Number.parseInt(opts.limit, 10);

      const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.spreadsheet' and name contains '${opts.name.replace(/'/g, "\\'")}'`,
        fields: "files(id, name, webViewLink, modifiedTime)",
        pageSize: limit,
        orderBy: "modifiedTime desc",
      });

      const files = res.data.files ?? [];
      output(
        success(cmd, {
          query: opts.name,
          count: files.length,
          spreadsheets: files.map((f) => ({
            id: f.id,
            name: f.name,
            url: f.webViewLink,
            modified: f.modifiedTime,
          })),
        })
      );
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err);
      output(result);
      process.exit(exitCode(result));
    }
  });

// Sheet info command
program
  .command("sheet")
  .description("Get sheet info")
  .command("info")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .option("--sheet <name>", "Sheet name")
  .option("--gid <gid>", "Sheet GID")
  .action(async (opts) => {
    const cmd = "sheet info";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    if (!(opts.sheet || opts.gid)) {
      output(
        error(cmd, "VALIDATION_ERROR", "Either --sheet or --gid is required")
      );
      return process.exit(10);
    }

    try {
      if (opts.gid) {
        const sheet = await getSheetByGid(
          client,
          spreadsheetId,
          Number.parseInt(opts.gid, 10)
        );
        if (!sheet) {
          output(
            error(
              cmd,
              "VALIDATION_ERROR",
              `Sheet with gid ${opts.gid} not found`
            )
          );
          return process.exit(10);
        }
        output(success(cmd, sheet, { spreadsheetId }));
      } else {
        const sheetsList = await listSheets(client, spreadsheetId);
        const sheet = sheetsList.find((s) => s.name === opts.sheet);
        if (!sheet) {
          output(
            error(cmd, "VALIDATION_ERROR", `Sheet "${opts.sheet}" not found`)
          );
          return process.exit(10);
        }
        output(success(cmd, sheet, { spreadsheetId, sheet: opts.sheet }));
      }
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(result);
      process.exit(exitCode(result));
    }
  });

// Header command
program
  .command("header")
  .description("Get header row for a sheet")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--sheet <name>", "Sheet name")
  .option("--header-row <row>", "Header row number (auto-detect if omitted)")
  .action(async (opts) => {
    const cmd = "header";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    try {
      const result = await getHeaderRow(
        client,
        spreadsheetId,
        opts.sheet,
        opts.headerRow ? Number.parseInt(opts.headerRow, 10) : undefined
      );
      output(
        success(
          cmd,
          { headers: result.headers, headerRow: result.headerRow },
          { spreadsheetId, sheet: opts.sheet }
        )
      );
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(result);
      process.exit(exitCode(result));
    }
  });

// Read commands
const read = program.command("read").description("Read data from sheets");

read
  .command("table")
  .description("Read sheet as table (header + rows)")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--sheet <name>", "Sheet name")
  .option("--limit <n>", "Max rows to return")
  .option("--range <range>", "A1 range for data (excluding header)")
  .option("--header-row <row>", "Header row number (auto-detect if omitted)")
  .option("--raw", "Return unformatted values")
  .action(async (opts) => {
    const cmd = "read table";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    try {
      const data = await readTableData(client, spreadsheetId, opts.sheet, {
        limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
        range: opts.range,
        headerRow: opts.headerRow
          ? Number.parseInt(opts.headerRow, 10)
          : undefined,
        raw: opts.raw,
      });
      output(success(cmd, data, { spreadsheetId, sheet: opts.sheet }));
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(result);
      process.exit(exitCode(result));
    }
  });

read
  .command("range")
  .description("Read raw A1 range")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--range <range>", "A1 range (e.g., Sheet1!A1:B10)")
  .action(async (opts) => {
    const cmd = "read range";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    try {
      const values = await readRange(client, spreadsheetId, opts.range);
      output(success(cmd, { values }, { spreadsheetId }));
      process.exit(0);
    } catch (err) {
      const result = handleApiError(cmd, err, spreadsheetId);
      output(result);
      process.exit(exitCode(result));
    }
  });

// Write commands
program
  .command("append")
  .description("Append a row to a sheet")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--sheet <name>", "Sheet name")
  .requiredOption("--values <json>", "JSON object with column values")
  .option("--header-row <row>", "Header row number (auto-detect if omitted)")
  .option("--value-input <mode>", "Value input option", "USER_ENTERED")
  .option("--dry-run", "Preview changes without applying")
  .action(async (opts) => {
    const cmd = "append";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    let values: Record<string, unknown>;
    try {
      values = JSON.parse(opts.values);
    } catch {
      output(error(cmd, "VALIDATION_ERROR", "Invalid JSON for --values"));
      return process.exit(10);
    }

    try {
      const result = await appendRows(
        client,
        spreadsheetId,
        opts.sheet,
        values,
        {
          valueInputOption: opts.valueInput as ValueInputOption,
          headerRow: opts.headerRow
            ? Number.parseInt(opts.headerRow, 10)
            : undefined,
          dryRun: opts.dryRun,
        }
      );
      output(success(cmd, result, { spreadsheetId, sheet: opts.sheet }));
      process.exit(0);
    } catch (err) {
      const res = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(res);
      process.exit(exitCode(res));
    }
  });

// Update commands
const update = program.command("update").description("Update cells");

update
  .command("row")
  .description("Update cells by row index")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--sheet <name>", "Sheet name")
  .requiredOption("--row <n>", "Row number (1-indexed)")
  .requiredOption("--set <json>", "JSON object with column values to set")
  .option("--header-row <row>", "Header row number (auto-detect if omitted)")
  .option("--value-input <mode>", "Value input option", "USER_ENTERED")
  .option("--dry-run", "Preview changes without applying")
  .action(async (opts) => {
    const cmd = "update row";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    let setValues: Record<string, unknown>;
    try {
      setValues = JSON.parse(opts.set);
    } catch {
      output(error(cmd, "VALIDATION_ERROR", "Invalid JSON for --set"));
      return process.exit(10);
    }

    try {
      const result = await updateByRowIndex(
        client,
        spreadsheetId,
        opts.sheet,
        Number.parseInt(opts.row, 10),
        setValues,
        {
          valueInputOption: opts.valueInput as ValueInputOption,
          headerRow: opts.headerRow
            ? Number.parseInt(opts.headerRow, 10)
            : undefined,
          dryRun: opts.dryRun,
        }
      );
      output(success(cmd, result, { spreadsheetId, sheet: opts.sheet }));
      process.exit(0);
    } catch (err) {
      const res = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(res);
      process.exit(exitCode(res));
    }
  });

update
  .command("key")
  .description("Update cells by key column value")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--sheet <name>", "Sheet name")
  .requiredOption("--key-col <column>", "Key column name")
  .requiredOption("--key <value>", "Key value to match")
  .requiredOption("--set <json>", "JSON object with column values to set")
  .option("--header-row <row>", "Header row number (auto-detect if omitted)")
  .option("--value-input <mode>", "Value input option", "USER_ENTERED")
  .option("--allow-multi", "Allow updating multiple matching rows")
  .option("--dry-run", "Preview changes without applying")
  .action(async (opts) => {
    const cmd = "update key";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    let setValues: Record<string, unknown>;
    try {
      setValues = JSON.parse(opts.set);
    } catch {
      output(error(cmd, "VALIDATION_ERROR", "Invalid JSON for --set"));
      return process.exit(10);
    }

    try {
      const result = await updateByKey(
        client,
        spreadsheetId,
        opts.sheet,
        opts.keyCol,
        opts.key,
        setValues,
        {
          valueInputOption: opts.valueInput as ValueInputOption,
          headerRow: opts.headerRow
            ? Number.parseInt(opts.headerRow, 10)
            : undefined,
          allowMulti: opts.allowMulti,
          dryRun: opts.dryRun,
        }
      );
      output(success(cmd, result, { spreadsheetId, sheet: opts.sheet }));
      process.exit(0);
    } catch (err) {
      const res = handleApiError(cmd, err, spreadsheetId, opts.sheet);
      output(res);
      process.exit(exitCode(res));
    }
  });

// Set range command
program
  .command("set")
  .description("Set values in a range")
  .command("range")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--range <range>", "A1 range (e.g., Sheet1!A1:B2)")
  .requiredOption("--values <json>", "2D JSON array of values")
  .option("--value-input <mode>", "Value input option", "USER_ENTERED")
  .option("--dry-run", "Preview changes without applying")
  .action(async (opts) => {
    const cmd = "set range";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    let values: unknown[][];
    try {
      values = JSON.parse(opts.values);
      if (!(Array.isArray(values) && values.every(Array.isArray))) {
        throw new Error("Must be 2D array");
      }
    } catch {
      output(
        error(cmd, "VALIDATION_ERROR", "Invalid 2D JSON array for --values")
      );
      return process.exit(10);
    }

    try {
      const result = await setRange(client, spreadsheetId, opts.range, values, {
        valueInputOption: opts.valueInput as ValueInputOption,
        dryRun: opts.dryRun,
      });
      output(success(cmd, result, { spreadsheetId }));
      process.exit(0);
    } catch (err) {
      const res = handleApiError(cmd, err, spreadsheetId);
      output(res);
      process.exit(exitCode(res));
    }
  });

// Batch command
program
  .command("batch")
  .description("Execute multiple operations")
  .option("--spreadsheet <id>", "Spreadsheet ID or URL", DEFAULT_SPREADSHEET_ID)
  .requiredOption("--ops <json>", "JSON array of operations")
  .option("--value-input <mode>", "Value input option", "USER_ENTERED")
  .option("--dry-run", "Preview changes without applying")
  .action(async (opts) => {
    const cmd = "batch";
    const spreadsheetId = resolveSpreadsheet(opts.spreadsheet);
    const client = await getSheets(cmd);
    if (!client) {
      return process.exit(20);
    }

    let operations: BatchOperation[];
    try {
      operations = JSON.parse(opts.ops);
      if (!Array.isArray(operations)) {
        throw new Error("Must be array");
      }
    } catch {
      output(error(cmd, "VALIDATION_ERROR", "Invalid JSON array for --ops"));
      return process.exit(10);
    }

    try {
      const result = await batchOperations(client, spreadsheetId, operations, {
        valueInputOption: opts.valueInput as ValueInputOption,
        dryRun: opts.dryRun,
      });
      output(success(cmd, result, { spreadsheetId }));
      process.exit(0);
    } catch (err) {
      const res = handleApiError(cmd, err, spreadsheetId);
      output(res);
      process.exit(exitCode(res));
    }
  });

// Install skill command
program
  .command("install-skill")
  .description("Install Agent Skill for Claude Code or OpenAI Codex")
  .option("--global", "Claude Code: ~/.claude/skills/ (personal)")
  .option("--codex", "OpenAI Codex: ~/.codex/skills/")
  .action(async (opts) => {
    const cmd = "install-skill";

    try {
      let baseDir: string;
      let platform: string;

      if (opts.codex) {
        baseDir = `${process.env.HOME}/.codex/skills`;
        platform = "Codex";
      } else if (opts.global) {
        baseDir = `${process.env.HOME}/.claude/skills`;
        platform = "Claude Code (global)";
      } else {
        baseDir = "./.claude/skills";
        platform = "Claude Code (project)";
      }

      const skillDir = `${baseDir}/sheets-cli`;
      await Bun.$`mkdir -p ${skillDir}`.quiet();
      const targetPath = `${skillDir}/SKILL.md`;
      await Bun.write(targetPath, SKILL_CONTENT);

      output(
        success(cmd, {
          installed: true,
          path: targetPath,
          platform,
          message: `Skill installed to ${targetPath}`,
        })
      );
      process.exit(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output(error(cmd, "API_ERROR", `Failed to install skill: ${msg}`));
      process.exit(40);
    }
  });

program.parse();
