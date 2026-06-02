import { config, getModelOverride } from "./model-config";
import { buildBillingHeaderValue } from "./signing";

const TOOL_PREFIX = "mcp_";
export const SYSTEM_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const BILLING_PREFIX = "x-anthropic-billing-header";

function prefixToolName(name: string): string {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function unprefixToolName(name: string): string {
  if (!name.startsWith(TOOL_PREFIX)) return name;
  const rest = name.slice(TOOL_PREFIX.length);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

type SystemEntry = { type?: string; text?: string; cache_control?: unknown };
type ContentBlock = { type?: string; text?: string; name?: string };
type Message = { role?: string; content?: string | ContentBlock[] };

function repairToolPairs(messages: Message[]): Message[] {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      const id = (block as { id?: string }).id;
      const toolUseId = (block as { tool_use_id?: string }).tool_use_id;
      if (block.type === "tool_use" && typeof id === "string")
        toolUseIds.add(id);
      if (block.type === "tool_result" && typeof toolUseId === "string")
        toolResultIds.add(toolUseId);
    }
  }
  const orphanedUses = new Set<string>();
  const orphanedResults = new Set<string>();
  for (const id of toolUseIds) if (!toolResultIds.has(id)) orphanedUses.add(id);
  for (const id of toolResultIds)
    if (!toolUseIds.has(id)) orphanedResults.add(id);
  if (!orphanedUses.size && !orphanedResults.size) return messages;
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const filtered = m.content.filter((b) => {
      const id = (b as { id?: string }).id;
      const toolUseId = (b as { tool_use_id?: string }).tool_use_id;
      if (b.type === "tool_use" && typeof id === "string")
        return !orphanedUses.has(id);
      if (b.type === "tool_result" && typeof toolUseId === "string")
        return !orphanedResults.has(toolUseId);
      return true;
    });
    if (filtered.length === 0) {
      return {
        ...m,
        content:
          m.role === "user"
            ? [{ type: "text", text: "[tool result omitted]" }]
            : [{ type: "text", text: "(no content)" }],
      };
    }
    return { ...m, content: filtered };
  });
}

export interface ClaudeCodeParams {
  model?: string;
  system?: SystemEntry[] | string;
  thinking?: object;
  output_config?: unknown;
  tools?: Array<{ name?: string }>;
  messages?: Message[];
}

/** Mutates and returns params. Do not call twice on the same object. */
export function applyClaudeCodeTransforms<T extends ClaudeCodeParams>(
  params: T,
): T {
  const version = process.env.ANTHROPIC_CLI_VERSION ?? config.ccVersion;
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? "sdk-cli";

  const billingHeader = buildBillingHeaderValue(
    (params.messages ?? []) as Parameters<typeof buildBillingHeaderValue>[0],
    version,
    entrypoint,
  );

  let system: SystemEntry[] = [];
  if (typeof params.system === "string") {
    if (params.system.trim())
      system.push({ type: "text", text: params.system });
  } else if (Array.isArray(params.system)) {
    system = [...params.system];
  }

  system = system.filter(
    (e) => !(typeof e.text === "string" && e.text.startsWith(BILLING_PREFIX)),
  );

  const hasIdentity = system.some(
    (e) => typeof e.text === "string" && e.text.startsWith(SYSTEM_IDENTITY),
  );

  const split: SystemEntry[] = [];
  for (const entry of system) {
    const text = typeof entry.text === "string" ? entry.text : "";
    if (
      text.startsWith(SYSTEM_IDENTITY) &&
      text.length > SYSTEM_IDENTITY.length
    ) {
      const rest = text.slice(SYSTEM_IDENTITY.length).replace(/^\n+/, "");
      const { text: _t, cache_control: _cc, ...identityProps } = entry;
      const { text: _t2, ...restProps } = entry;
      split.push({ ...identityProps, type: "text", text: SYSTEM_IDENTITY });
      if (rest) split.push({ ...restProps, type: "text", text: rest });
    } else {
      split.push(entry);
    }
  }
  system = split;

  if (!hasIdentity) {
    system.unshift({ type: "text", text: SYSTEM_IDENTITY });
  }

  const kept: SystemEntry[] = [];
  const moved: string[] = [];
  for (const entry of system) {
    const text = typeof entry.text === "string" ? entry.text : "";
    if (text.startsWith(BILLING_PREFIX) || text.startsWith(SYSTEM_IDENTITY)) {
      kept.push(entry);
    } else if (text) {
      moved.push(text);
    }
  }
  if (moved.length && Array.isArray(params.messages)) {
    const prefix = moved.join("\n\n");
    const firstUser = params.messages.find((m) => m.role === "user");
    if (firstUser) {
      if (typeof firstUser.content === "string") {
        firstUser.content = `${prefix}\n\n${firstUser.content}`;
      } else if (Array.isArray(firstUser.content)) {
        firstUser.content.unshift({ type: "text", text: prefix });
      }
    } else {
      // No user turn to carry the system text; synthesize one so the prompt is
      // not dropped and the request is not sent with zero messages.
      params.messages.unshift({ role: "user", content: prefix });
    }
  }

  kept.unshift({ type: "text", text: billingHeader });
  params.system = kept;

  const override = getModelOverride(params.model ?? "");
  if (
    override?.disableEffort &&
    params.thinking &&
    "effort" in params.thinking
  ) {
    delete (params.thinking as { effort?: unknown }).effort;
    if (!Object.keys(params.thinking).length) delete params.thinking;
  }

  if (Array.isArray(params.tools)) {
    params.tools = params.tools.map((t) => ({
      ...t,
      name: t.name ? prefixToolName(t.name) : t.name,
    }));
  }

  if (Array.isArray(params.messages)) {
    params.messages = params.messages.map((m) => {
      if (!Array.isArray(m.content)) return m;
      return {
        ...m,
        content: m.content.map((b) => {
          if (b.type === "tool_use" && typeof b.name === "string") {
            return { ...b, name: prefixToolName(b.name) };
          }
          return b;
        }),
      };
    });
    params.messages = repairToolPairs(params.messages);
  }

  return params;
}
