import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthStorage } from "@earendil-works/pi-coding-agent";

const DEFAULT_OPENCODE_AUTH = path.join(
  os.homedir(),
  ".local/share/opencode/auth.json",
);

export const readOpencodeKey = (
  authPath: string = DEFAULT_OPENCODE_AUTH,
): string | undefined => {
  try {
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<
      string,
      { key?: string }
    >;
    return auth["opencode-go"]?.key;
  } catch {
    return undefined;
  }
};

export const bridgeOpencodeAuth = (
  authStorage: AuthStorage,
  authPath?: string,
): boolean => {
  const key = readOpencodeKey(authPath);
  if (!key) return false;
  for (const provider of ["opencode", "opencode-go"])
    authStorage.setRuntimeApiKey(provider, key);
  return true;
};
