// Native opencode / OpenCode Zen chat model. Talks the OpenAI-compatible
// chat/completions endpoint directly via @langchain/openai — NO pi-ai, NO
// opencode binary. The bearer key opencode provisioned on login is read from
// ~/.local/share/opencode/auth.json (or OPENCODE_API_KEY / an explicit apiKey).
//
// Free models (provider "opencode"): deepseek-v4-flash-free, big-pickle,
// mimo-v2.5-free, nemotron-3-super-free. Subpath: `langchain-pi-ts/opencode`.
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { readOpencodeKey } from "./opencode";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const ZEN_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export type ChatOpencodeFields = Omit<ChatOpenAIFields, "configuration"> & {
  model: string;
  /** "zen" → opencode.ai/zen/v1 (default), "go" → opencode.ai/zen/go/v1 */
  tier?: "zen" | "go";
};

export class ChatOpencode extends ChatOpenAI {
  constructor(fields: ChatOpencodeFields) {
    const { tier = "zen", apiKey, ...rest } = fields;
    const key = apiKey ?? process.env.OPENCODE_API_KEY ?? readOpencodeKey();
    const baseURL = tier === "go" ? ZEN_GO_BASE_URL : ZEN_BASE_URL;
    // With a key: normal auth (unlocks paid models + higher limits). Without:
    // anonymous free tier — the gateway serves free models on a blank
    // Authorization header. The SDK rejects an empty apiKey, so we pass a
    // placeholder and override the header to "" (which the gateway accepts).
    super({
      ...rest,
      apiKey: key ?? "anonymous",
      configuration: key
        ? { baseURL }
        : { baseURL, defaultHeaders: { Authorization: "" } },
    });
  }
}
