import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("auth", () => {
  const testTokenPath = "/tmp/test-sheets-cli/token.json";
  const _testCredPath = "/tmp/test-sheets-cli/credentials.json";

  const _mockCredentials = {
    installed: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      redirect_uris: ["urn:ietf:wg:oauth:2.0:oob"],
    },
  };

  const mockToken = {
    access_token: "test-access-token",
    refresh_token: "test-refresh-token",
    token_type: "Bearer",
  };

  beforeEach(async () => {
    // Clean up test directory
    await Bun.$`rm -rf /tmp/test-sheets-cli`.quiet().nothrow();
    await Bun.$`mkdir -p /tmp/test-sheets-cli`.quiet();
  });

  afterEach(async () => {
    await Bun.$`rm -rf /tmp/test-sheets-cli`.quiet().nothrow();
  });

  describe("getAuthClient", () => {
    test("returns null when token file does not exist", async () => {
      const { getAuthClient } = await import("../auth");
      const result = await getAuthClient("/nonexistent/path/token.json");
      expect(result).toBeNull();
    });

    test("returns null when credentials file does not exist", async () => {
      // Create token but no credentials
      await Bun.write(testTokenPath, JSON.stringify(mockToken));

      // Point to non-existent credentials
      const origEnv = process.env.GF_SHEET_CREDENTIALS;
      process.env.GF_SHEET_CREDENTIALS = "/tmp/nonexistent/credentials.json";

      try {
        const { getAuthClient } = await import("../auth");
        const result = await getAuthClient(testTokenPath);
        expect(result).toBeNull();
      } finally {
        if (origEnv) {
          process.env.GF_SHEET_CREDENTIALS = origEnv;
        } else {
          process.env.GF_SHEET_CREDENTIALS = undefined;
        }
      }
    });
  });

  describe("logout", () => {
    test("removes token file when it exists", async () => {
      await Bun.write(testTokenPath, JSON.stringify(mockToken));

      const { logout } = await import("../auth");
      const result = await logout(testTokenPath);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Logged out successfully");

      const exists = await Bun.file(testTokenPath).exists();
      expect(exists).toBe(false);
    });

    test("returns success when no token file exists", async () => {
      const { logout } = await import("../auth");
      const result = await logout(testTokenPath);

      expect(result.success).toBe(true);
      expect(result.message).toBe("No active session");
    });
  });

  describe("getAuthStatus", () => {
    test("returns unauthenticated when no token exists", async () => {
      const { getAuthStatus } = await import("../auth");
      const result = await getAuthStatus(testTokenPath);

      expect(result.authenticated).toBe(false);
      expect(result.tokenPath).toBe(testTokenPath);
    });
  });

  describe("login", () => {
    test("returns error when credentials file does not exist", async () => {
      const { login } = await import("../auth");
      const result = await login(
        "/nonexistent/credentials.json",
        testTokenPath
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Credentials file not found");
    });

    // Note: Full login flow requires user interaction (OAuth consent)
    // and cannot be tested without mocking readline/OAuth flow
  });
});

describe("auth module structure", () => {
  test("exports getAuthClient function", async () => {
    const auth = await import("../auth");
    expect(typeof auth.getAuthClient).toBe("function");
  });

  test("exports login function", async () => {
    const auth = await import("../auth");
    expect(typeof auth.login).toBe("function");
  });

  test("exports logout function", async () => {
    const auth = await import("../auth");
    expect(typeof auth.logout).toBe("function");
  });

  test("exports getAuthStatus function", async () => {
    const auth = await import("../auth");
    expect(typeof auth.getAuthStatus).toBe("function");
  });
});
