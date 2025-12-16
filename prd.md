PRD (MVP): `gf-sheet` — Bun-compiled CLI for Google Sheets primitives

1. Goal
   A small, deterministic CLI (TypeScript, Bun) that exposes low-level, composable primitives for Google Sheets:

* Read sheet/tabular data
* Append rows
* Update cells/columns (by row index, by key, or by A1 range)
* Batch multiple operations
* Emit JSON-only output for agent consumption

Initial default target (but not hard-limited):

* Default spreadsheetId: 1-831oQ6kGZmaTNnVBaeG3nUiBoF-dGwsJbjJzq4N93M

2. Scope (MVP)
   Supported operations:

* auth: login/status/logout
* metadata: list sheets/tabs, get header row, resolve gid→sheet name
* read:

  * read “table mode” (header + rows)
  * read raw ranges
* write:

  * append rows (object→row mapping using header)
  * update by row index + column(s)
  * update by key column + key value + column(s)
  * update arbitrary A1 range (escape hatch)
  * batch mixed operations
* safety features:

  * dry-run for any write
  * optional guardrails config (not mandatory)

3. Non-goals (MVP)

* Any “business logic” mapping from notes/projects into the sheet (the agent does this)
* Formatting, conditional formatting, filters, sheet structure changes
* Multi-user approvals or workflow state machines
* A persistent daemon/service

4. User-visible commands (MVP)

Auth

* gf-sheet auth login --credentials <oauth_client.json> [--token-store <path>]
* gf-sheet auth status
* gf-sheet auth logout

Metadata

* gf-sheet sheets list [--spreadsheet <id>]
* gf-sheet sheet info --sheet "<name>" | --gid <gid>
* gf-sheet header --sheet "<name>" [--header-row 1]

Read

* gf-sheet read table --sheet "<name>" [--limit 500] [--range "A1:Z500"] [--raw]
* gf-sheet read range --range "<sheet>!A1:Z50"

Write

* gf-sheet append --sheet "<name>" --values '<json>' [--value-input USER_ENTERED|RAW] [--dry-run]
* gf-sheet update row --sheet "<name>" --row 12 --set '<json>' [--dry-run]
* gf-sheet update key --sheet "<name>" --key-col "PortCo" --key "eGroup" --set '<json>' [--dry-run] [--allow-multi]
* gf-sheet set range --range "<sheet>!M2:M2" --values '<json_2d_array>' [--dry-run]
* gf-sheet batch --ops '<json>' [--dry-run]

Notes:

* `append` and `batch` should use the Sheets Values endpoints (append/batchUpdate) for correctness and fewer API calls. ([Google for Developers][1])

5. Data model assumptions for your tracker sheet (starting point)
   Your header row (columns) is:

PortCo
Project Name
Project Type
Project Subcategory
Start Date
End Date
Description
Priority
Impact
Effort
PoC Portco
Deal Team
Fee (Euro)
Status
Intro Call
Update 1
1st Follow Up
Update 2
Update 3
Update 4
Update 5
Outcome

MVP behavior:

* Column mapping is by header name (normalized: trim, collapse spaces, case-insensitive).
* Append/update accept JSON objects keyed by these headers.
* Dates can be sent as strings; with `USER_ENTERED` the sheet interprets them as user input. ([Google for Developers][2])

6. “Not too limited” design
   You want “edit anything and any sheet” long-term. The CLI should therefore support three tiers:

Tier A: High-level table ops (preferred for agents)

* append object rows by header
* update by key/row with column names

Tier B: Generic range ops (escape hatch)

* get/set A1 ranges directly
* batchUpdate multiple ranges

Tier C: Spreadsheet selection

* always accept `--spreadsheet <id>` and `--sheet <name>` overrides
* default to your current spreadsheetId for convenience

7. Optional guardrails (recommended but not mandatory)
   Default mode: permissive (any spreadsheet you have access to, any tab, any column).

Add a guard mode you can turn on when you want:

* config file `.gf-sheet.json` or env var `GF_SHEET_CONFIG`
* allowlists: spreadsheet IDs, sheets, writable columns
* deny-by-default when enabled

Reason: agentic tools will eventually issue surprising writes; guard mode prevents accidental corruption without blocking your “edit anything” requirement.

8. Output contract (machine-readable)
   stdout: JSON only.

Success:
{
"ok": true,
"cmd": "append",
"spreadsheetId": "...",
"sheet": "...",
"result": { ... }
}

Error:
{
"ok": false,
"cmd": "update key",
"error": { "code": "VALIDATION_ERROR|AUTH_ERROR|PERMISSION_ERROR|API_ERROR", "message": "...", "details": {...} }
}

Exit codes:
0 success
10 validation
20 auth
30 permission
40 transient/API

9. Bun-specific build/runtime requirements
   Build:

* bun build ./src/cli.ts --compile --outfile ./dist/gf-sheet ([Bun][3])

Runtime config:

* rely on Bun’s `.env` autoload for convenience in dev if you want, but provide a deterministic build option because `.env` autoload in compiled executables can cause surprising behavior depending on working directory. ([Bun][4])
  Deterministic build:
* bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig ./src/cli.ts --outfile ./dist/gf-sheet ([Bun][4])

Tests:

* bun test (use bun’s test runner; add a small HTTP-mocking layer or isolate Sheets calls behind an interface). ([Bun][4])

10. MVP implementation notes (important for correctness)

* Use `spreadsheets.values.append` for appends (table detection behavior) ([Google for Developers][1])
* Use `spreadsheets.values.batchUpdate` for multi-range writes (updates + multiple cells) ([Google for Developers][2])
* For key-based updates:

  * read the key column range once
  * find matching row(s)
  * compute target A1 ranges for the columns being updated
  * perform one batchUpdate

11. Recommended (but optional) “row identity” improvement
    Key-based updates will be fragile if “PortCo” repeats or “Project Name” is blank. Consider adding a new column like:

* GF_ID (immutable UUID-ish string)
  Once present, agents can upsert/update deterministically.

If you tell me the actual tab name that contains this header row (and whether header is row 1), I can produce:

* the exact command patterns Claude Code should use safely (read → decide → dry-run → apply)
* the minimal JSON schema for batch ops that stays stable as you add more commands.

We will need to add an instructions.md file that includes the exact command patterns claude code can use so that users can add that to their CLAUDE.md / AGENTS.md files.

We will need scripts for building the cli app, ie. bun build ./cli.ts --compile --outfile mycli also scripts for running dev mode with hot reloading and for running bun tests.

[1]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append?utm_source=chatgpt.com "Method: spreadsheets.values.append | Google Sheets"
[2]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate?utm_source=chatgpt.com "Method: spreadsheets.values.batchUpdate | Google Sheets"
[3]: https://bun.com/docs/bundler/executables?utm_source=chatgpt.com "Single-file executable"
[4]: https://bun.com/blog/bun-v1.3.3?utm_source=chatgpt.com "Bun v1.3.3 | Bun Blog"
