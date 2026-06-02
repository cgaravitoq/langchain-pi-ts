import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const OAUTH_TOKEN_URL = "https://claude.ai/v1/oauth/token";
export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export interface ClaudeCodeCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface CredentialBlob {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

function parseBlob(raw: string): ClaudeCodeCreds | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data =
    (parsed as { claudeAiOauth?: CredentialBlob }).claudeAiOauth ??
    (parsed as CredentialBlob);

  const access = data.accessToken ?? data.access_token;
  const refresh = data.refreshToken ?? data.refresh_token;
  const expires = data.expiresAt ?? data.expires_at;

  if (!access || !refresh || typeof expires !== "number") return null;
  return { accessToken: access, refreshToken: refresh, expiresAt: expires };
}

function isExecTimeout(err: unknown): boolean {
  const e = err as { code?: string; signal?: string; name?: string };
  return (
    e.code === "ETIMEDOUT" ||
    e.signal === "SIGTERM" ||
    e.name === "TimeoutError"
  );
}

function readFromKeychain(): ClaudeCodeCreds | null {
  if (process.platform !== "darwin") return null;
  const services = ["Claude Code-credentials"];
  try {
    const dump = execSync(
      'security dump-keychain 2>/dev/null | grep -o \'"Claude Code-credentials[^"]*"\'',
      { encoding: "utf-8", timeout: 5_000 },
    );
    const found = Array.from(
      new Set(
        dump
          .split("\n")
          .map((s) => s.replace(/"/g, "").trim())
          .filter(Boolean),
      ),
    );
    if (found.length > 0) services.splice(0, services.length, ...found);
  } catch (err) {
    if (isExecTimeout(err)) return null;
  }
  for (const svc of services) {
    try {
      const out = execSync(
        `security find-generic-password -s ${JSON.stringify(svc)} -w`,
        { encoding: "utf-8", timeout: 5_000 },
      ).trim();
      const creds = parseBlob(out);
      if (creds) return creds;
    } catch (err) {
      if (isExecTimeout(err)) return null;
    }
  }
  return null;
}

function getCredentialsFilePath(): string {
  return join(homedir(), ".claude", ".credentials.json");
}

function readFromFile(): ClaudeCodeCreds | null {
  const path = getCredentialsFilePath();
  if (!existsSync(path)) return null;
  try {
    return parseBlob(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function readClaudeCodeCreds(): ClaudeCodeCreds | null {
  return readFromKeychain() ?? readFromFile();
}

function writeBackToFile(creds: ClaudeCodeCreds): void {
  const path = getCredentialsFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      // overwrite
    }
  }
  const updated = {
    ...existing,
    claudeAiOauth: {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
    },
  };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(updated, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    if (process.platform !== "win32") chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw err;
  }
}

interface OAuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
}

async function refreshViaOAuth(
  refreshToken: string,
): Promise<ClaudeCodeCreds | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as OAuthResponse;
  if (!data.access_token) return null;
  const ttlSec = Number(data.expires_in);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt:
      Date.now() +
      (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 36_000) * 1000,
  };
}

function stringifyRefreshError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 200 ? `${message.slice(0, 200)}...` : message;
}

function claudeCliPath(): string | null {
  const probe =
    process.platform === "win32" ? "where claude" : "command -v claude";
  try {
    const out = execSync(probe, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)[0];
    return out || null;
  } catch {
    return null;
  }
}

function refreshViaCli(): string | null {
  const cli = claudeCliPath();
  if (!cli) return "claude CLI not found on PATH";
  try {
    execSync(`${JSON.stringify(cli)} -p . --model haiku`, {
      timeout: 20_000,
      encoding: "utf-8",
      env: { ...process.env, TERM: "dumb" },
      stdio: ["ignore", "ignore", "pipe"],
      cwd: tmpdir(),
    });
    return null;
  } catch (err) {
    const e = err as {
      code?: string;
      signal?: string;
      stderr?: Buffer | string;
    };
    if (e.signal === "SIGTERM") return "claude CLI refresh timed out after 20s";
    const stderr =
      typeof e.stderr === "string"
        ? e.stderr
        : (e.stderr?.toString("utf-8") ?? "");
    const firstLine = stderr.split(/\r?\n/).find((l) => l.trim());
    return firstLine
      ? `claude CLI: ${firstLine}`
      : `claude CLI failed (${e.code ?? "unknown"})`;
  }
}

// Module-level lock so concurrent callers reuse the same refresh promise. The
// OAuth server rotates the refresh token on success, so parallel refreshes with
// the same token would race and all but one would fail.
let inFlightRefresh: Promise<ClaudeCodeCreds> | null = null;

export function refreshClaudeCodeCreds(
  current: ClaudeCodeCreds,
): Promise<ClaudeCodeCreds> {
  if (current.expiresAt > Date.now() + 60_000) return Promise.resolve(current);
  return performRefresh(current);
}

// Force a refresh even when the token still looks fresh — used on a 401 where a
// timestamp-fresh token was rejected (revoked or rotated out-of-band). Reuses a
// token another caller already rotated to instead of re-POSTing the stale one.
export function forceRefreshClaudeCodeCreds(
  current: ClaudeCodeCreds,
): Promise<ClaudeCodeCreds> {
  if (inFlightRefresh) return inFlightRefresh;
  const onDisk = readClaudeCodeCreds();
  if (
    onDisk &&
    onDisk.refreshToken !== current.refreshToken &&
    onDisk.expiresAt > Date.now() + 60_000
  ) {
    return Promise.resolve(onDisk);
  }
  return performRefresh(current);
}

function performRefresh(current: ClaudeCodeCreds): Promise<ClaudeCodeCreds> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      let oauthError: unknown;
      const oauth = await refreshViaOAuth(current.refreshToken).catch((e) => {
        oauthError = e;
        return null;
      });
      if (oauth && oauth.expiresAt > Date.now() + 60_000) {
        try {
          writeBackToFile(oauth);
        } catch {
          // non-fatal
        }
        return oauth;
      }

      const cliReason = refreshViaCli();
      const reread = readClaudeCodeCreds();
      if (reread && reread.expiresAt > Date.now() + 60_000) return reread;

      const reasons = [
        cliReason,
        oauthError ? `OAuth: ${stringifyRefreshError(oauthError)}` : null,
      ].filter(Boolean);
      const suffix = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
      throw new Error(
        `Failed to refresh Claude Code credentials${suffix}. Run \`claude\` once to re-authenticate.`,
      );
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}
