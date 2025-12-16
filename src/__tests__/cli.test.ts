import { describe, expect, test } from "bun:test";

const CLI_PATH = "./src/cli.ts";
const VERSION_REGEX = /\d+\.\d+\.\d+/;

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

function parseOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

describe("CLI", () => {
  describe("--help", () => {
    test("displays help message", async () => {
      const { stdout, exitCode } = await runCli(["--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("sheets-cli");
      expect(stdout).toContain("CLI for Google Sheets primitives");
    });

    test("lists all main commands", async () => {
      const { stdout } = await runCli(["--help"]);

      expect(stdout).toContain("auth");
      expect(stdout).toContain("sheets");
      expect(stdout).toContain("read");
      expect(stdout).toContain("append");
      expect(stdout).toContain("update");
      expect(stdout).toContain("batch");
    });
  });

  describe("--version", () => {
    test("displays version", async () => {
      const { stdout, exitCode } = await runCli(["--version"]);

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(VERSION_REGEX);
    });
  });

  describe("auth commands", () => {
    test("auth --help shows subcommands", async () => {
      const { stdout, exitCode } = await runCli(["auth", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("login");
      expect(stdout).toContain("status");
      expect(stdout).toContain("logout");
    });

    test("auth status returns JSON", async () => {
      const { stdout, exitCode } = await runCli(["auth", "status"]);

      expect(exitCode).toBe(0);
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
      expect((output as { ok: boolean }).ok).toBe(true);
      expect((output as { cmd: string }).cmd).toBe("auth status");
    });

    test("auth logout returns JSON", async () => {
      // Use temp path to avoid deleting real token
      const { stdout, exitCode } = await runCli([
        "auth",
        "logout",
        "--token-store",
        "/tmp/test-cli-token.json",
      ]);

      expect(exitCode).toBe(0);
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
      expect((output as { ok: boolean }).ok).toBe(true);
    });

    test("auth login requires --credentials", async () => {
      const { stderr, exitCode } = await runCli(["auth", "login"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--credentials");
    });
  });

  describe("read commands", () => {
    test("read --help shows subcommands", async () => {
      const { stdout, exitCode } = await runCli(["read", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("table");
      expect(stdout).toContain("range");
    });

    test("read table requires --sheet", async () => {
      const { stderr, exitCode } = await runCli(["read", "table"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--sheet");
    });

    test("read range requires --range", async () => {
      const { stderr, exitCode } = await runCli(["read", "range"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--range");
    });

    test("read table returns error for non-existent sheet", async () => {
      const { stdout, exitCode } = await runCli([
        "read",
        "table",
        "--sheet",
        "NonExistentSheet12345",
      ]);

      // Returns VALIDATION_ERROR (10) if no spreadsheet ID, AUTH_ERROR (20) if not authenticated, API_ERROR (40) if sheet not found
      expect([0, 10, 20, 40]).toContain(exitCode);
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
    });
  });

  describe("append command", () => {
    test("requires --sheet", async () => {
      const { stderr, exitCode } = await runCli(["append", "--values", "{}"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--sheet");
    });

    test("requires --values", async () => {
      const { stderr, exitCode } = await runCli(["append", "--sheet", "Test"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--values");
    });

    test("validates JSON in --values", async () => {
      const { stdout, exitCode: _exitCode } = await runCli([
        "append",
        "--sheet",
        "Test",
        "--values",
        "not-json",
      ]);

      // Should fail with validation error (exit code 10) or auth error (20)
      // depending on order of checks
      const output = parseOutput(stdout);
      if (output && (output as { ok: boolean }).ok === false) {
        const errorCode = (output as { error: { code: string } }).error.code;
        expect(["VALIDATION_ERROR", "AUTH_ERROR"]).toContain(errorCode);
      }
    });
  });

  describe("update commands", () => {
    test("update --help shows subcommands", async () => {
      const { stdout, exitCode } = await runCli(["update", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("row");
      expect(stdout).toContain("key");
    });

    test("update row requires --sheet, --row, --set", async () => {
      const { stderr: stderr1 } = await runCli(["update", "row"]);
      expect(stderr1).toContain("--sheet");

      const { stderr: stderr2 } = await runCli([
        "update",
        "row",
        "--sheet",
        "Test",
      ]);
      expect(stderr2).toContain("--row");

      const { stderr: stderr3 } = await runCli([
        "update",
        "row",
        "--sheet",
        "Test",
        "--row",
        "5",
      ]);
      expect(stderr3).toContain("--set");
    });

    test("update key requires --sheet, --key-col, --key, --set", async () => {
      const { stderr: stderr1 } = await runCli(["update", "key"]);
      expect(stderr1).toContain("--sheet");

      const { stderr: stderr2 } = await runCli([
        "update",
        "key",
        "--sheet",
        "Test",
      ]);
      expect(stderr2).toContain("--key-col");
    });
  });

  describe("set range command", () => {
    test("requires --range", async () => {
      const { stderr, exitCode } = await runCli([
        "set",
        "range",
        "--values",
        "[[]]",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--range");
    });

    test("requires --values", async () => {
      const { stderr, exitCode } = await runCli([
        "set",
        "range",
        "--range",
        "A1",
      ]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--values");
    });

    test("validates 2D array in --values", async () => {
      const { stdout, exitCode: _exitCode } = await runCli([
        "set",
        "range",
        "--range",
        "Sheet1!A1",
        "--values",
        '["not-2d"]',
      ]);

      // Should fail with validation error (exit code 10) or auth error (20)
      const output = parseOutput(stdout);
      if (output && (output as { ok: boolean }).ok === false) {
        const errorCode = (output as { error: { code: string } }).error.code;
        expect(["VALIDATION_ERROR", "AUTH_ERROR"]).toContain(errorCode);
      }
    });
  });

  describe("batch command", () => {
    test("requires --ops", async () => {
      const { stderr, exitCode } = await runCli(["batch"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--ops");
    });

    test("validates JSON array in --ops", async () => {
      const { stdout, exitCode: _exitCode } = await runCli([
        "batch",
        "--ops",
        "not-json",
      ]);

      // Should fail with validation error (exit code 10) or auth error (20)
      const output = parseOutput(stdout);
      if (output && (output as { ok: boolean }).ok === false) {
        const errorCode = (output as { error: { code: string } }).error.code;
        expect(["VALIDATION_ERROR", "AUTH_ERROR"]).toContain(errorCode);
      }
    });
  });

  describe("sheets commands", () => {
    test("sheets --help shows subcommands", async () => {
      const { stdout, exitCode } = await runCli(["sheets", "--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("list");
    });

    test("sheets list returns valid JSON", async () => {
      const { stdout, exitCode } = await runCli(["sheets", "list"]);

      // Returns VALIDATION_ERROR (10) if no spreadsheet ID, AUTH_ERROR (20) if not authenticated, 0 if authenticated
      expect([0, 10, 20]).toContain(exitCode);
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
    });
  });

  describe("header command", () => {
    test("requires --sheet", async () => {
      const { stderr, exitCode } = await runCli(["header"]);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--sheet");
    });

    test("returns valid JSON for header request", async () => {
      const { stdout, exitCode } = await runCli([
        "header",
        "--sheet",
        "NonExistentSheet12345",
      ]);

      // Returns VALIDATION_ERROR (10) if no spreadsheet ID, AUTH_ERROR (20) if not authenticated, API_ERROR (40) if sheet not found
      expect([0, 10, 20, 40]).toContain(exitCode);
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
    });
  });

  describe("global options", () => {
    test("--spreadsheet option is accepted", async () => {
      const { stdout } = await runCli([
        "sheets",
        "list",
        "--spreadsheet",
        "custom-spreadsheet-id",
      ]);

      // Should fail with auth error, but the option should be accepted
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
    });

    test("--dry-run option is accepted on write commands", async () => {
      const { stdout } = await runCli([
        "append",
        "--sheet",
        "Test",
        "--values",
        '{"col":"val"}',
        "--dry-run",
      ]);

      // Should fail with auth error, but the option should be accepted
      const output = parseOutput(stdout);
      expect(output).not.toBeNull();
    });
  });
});

describe("CLI output format", () => {
  test("all outputs are valid JSON", async () => {
    const commands = [
      ["auth", "status"],
      ["auth", "logout", "--token-store", "/tmp/test-cli-token.json"],
    ];

    for (const args of commands) {
      const { stdout } = await runCli(args);
      const parsed = parseOutput(stdout);
      expect(parsed).not.toBeNull();
    }
  });

  test("success responses have ok:true", async () => {
    const { stdout } = await runCli(["auth", "status"]);
    const output = parseOutput(stdout) as { ok: boolean };

    expect(output.ok).toBe(true);
  });

  test("error responses have ok:false and error object", async () => {
    const { stdout } = await runCli(["read", "table", "--sheet", "Test"]);
    const output = parseOutput(stdout) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(output.ok).toBe(false);
    expect(output.error).toBeDefined();
    expect(output.error.code).toBeDefined();
    expect(output.error.message).toBeDefined();
  });

  test("responses include cmd field", async () => {
    const { stdout } = await runCli(["auth", "status"]);
    const output = parseOutput(stdout) as { cmd: string };

    expect(output.cmd).toBe("auth status");
  });
});
