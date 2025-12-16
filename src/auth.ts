import * as path from "node:path";
import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
];
const DEFAULT_TOKEN_PATH = path.join(
  process.env.HOME ?? "~",
  ".sheets-cli",
  "token.json"
);
const LOOPBACK_PORT = 3847;

export type AuthConfig = {
  credentialsPath: string;
  tokenPath?: string;
};

export async function getAuthClient(
  tokenPath = DEFAULT_TOKEN_PATH
): Promise<OAuth2Client | null> {
  try {
    const tokenFile = Bun.file(tokenPath);
    if (!(await tokenFile.exists())) {
      return null;
    }

    const token = await tokenFile.json();

    // Find credentials file
    const credentialsPath =
      process.env.GF_SHEET_CREDENTIALS ??
      path.join(process.env.HOME ?? "~", ".sheets-cli", "credentials.json");
    const credFile = Bun.file(credentialsPath);
    if (!(await credFile.exists())) {
      return null;
    }

    const credentials = await credFile.json();
    const { client_id, client_secret, redirect_uris } =
      credentials.installed ?? credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris?.[0] ?? "urn:ietf:wg:oauth:2.0:oob"
    );

    oauth2Client.setCredentials(token);
    return oauth2Client;
  } catch {
    return null;
  }
}

function waitForAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        // Schedule server shutdown
        setTimeout(() => server.stop(), 100);

        if (error) {
          reject(new Error(`OAuth error: ${error}`));
          return new Response(
            "<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (code) {
          resolve(code);
          return new Response(
            "<html><body><h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        return new Response("Waiting for OAuth callback...", { status: 200 });
      },
    });
  });
}

export async function login(
  credentialsPath: string,
  tokenPath = DEFAULT_TOKEN_PATH
): Promise<{ success: boolean; message: string }> {
  try {
    const credFile = Bun.file(credentialsPath);
    if (!(await credFile.exists())) {
      return {
        success: false,
        message: `Credentials file not found: ${credentialsPath}`,
      };
    }

    const credentials = await credFile.json();
    const { client_id, client_secret } =
      credentials.installed ?? credentials.web;

    const redirectUri = `http://localhost:${LOOPBACK_PORT}`;
    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });

    console.error("\nOpening browser for authentication...");
    console.error(`If browser doesn't open, visit:\n${authUrl}\n`);

    // Try to open browser
    let openCmd = "xdg-open";
    if (process.platform === "darwin") {
      openCmd = "open";
    } else if (process.platform === "win32") {
      openCmd = "start";
    }
    Bun.$`${openCmd} ${authUrl}`.quiet().nothrow();

    // Wait for OAuth callback
    const code = await waitForAuthCode(LOOPBACK_PORT);
    const { tokens } = await oauth2Client.getToken(code);

    // Ensure directory exists
    const tokenDir = path.dirname(tokenPath);
    await Bun.$`mkdir -p ${tokenDir}`.quiet();

    // Copy credentials to config dir if not already there
    const configCredPath = path.join(tokenDir, "credentials.json");
    if (path.resolve(credentialsPath) !== path.resolve(configCredPath)) {
      await Bun.write(configCredPath, await credFile.text());
    }

    await Bun.write(tokenPath, JSON.stringify(tokens, null, 2));

    return { success: true, message: "Authentication successful" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Authentication failed: ${msg}` };
  }
}

export async function getAuthStatus(
  tokenPath = DEFAULT_TOKEN_PATH
): Promise<{ authenticated: boolean; tokenPath: string }> {
  const client = await getAuthClient(tokenPath);
  return { authenticated: client !== null, tokenPath };
}

export async function logout(
  tokenPath = DEFAULT_TOKEN_PATH
): Promise<{ success: boolean; message: string }> {
  try {
    const tokenFile = Bun.file(tokenPath);
    if (await tokenFile.exists()) {
      await Bun.$`rm ${tokenPath}`.quiet();
      return { success: true, message: "Logged out successfully" };
    }
    return { success: true, message: "No active session" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Logout failed: ${msg}` };
  }
}
