import { ChatPi, type ChatPiFields } from "./chat-models";
import { ChatClaudeCode, type ChatClaudeCodeFields } from "./claude-code-chat";
import { ChatOpencode, type ChatOpencodeFields } from "./opencode-chat";

export type CreateChatFields = {
  provider: string;
  model: string;
} & Partial<Omit<ChatPiFields, "provider" | "modelId">> &
  Partial<Omit<ChatOpencodeFields, "model" | "tier">> &
  Partial<Omit<ChatClaudeCodeFields, "model">>;

// One entry, routed by provider: opencode / opencode-go → ChatOpencode (native
// OpenAI-compatible Zen), claude-code → ChatClaudeCode (native Anthropic via the
// Claude Code subscription), everything else → ChatPi (via pi).
export function createChat(
  fields: CreateChatFields,
): ChatPi | ChatOpencode | ChatClaudeCode {
  const { provider, model, ...rest } = fields;
  if (provider === "opencode" || provider === "opencode-go") {
    return new ChatOpencode({
      ...rest,
      model,
      tier: provider === "opencode-go" ? "go" : "zen",
    } as unknown as ChatOpencodeFields);
  }
  if (provider === "claude-code") {
    return new ChatClaudeCode({
      ...rest,
      model,
    } as unknown as ChatClaudeCodeFields);
  }
  return new ChatPi({
    ...rest,
    provider,
    modelId: model,
  } as unknown as ChatPiFields);
}
