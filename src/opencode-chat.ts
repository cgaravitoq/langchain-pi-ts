import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const ZEN_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export type ChatOpencodeFields = Omit<ChatOpenAIFields, "configuration"> & {
  model: string;
  tier?: "zen" | "go";
};

export class ChatOpencode extends ChatOpenAI {
  constructor(fields: ChatOpencodeFields) {
    const { tier = "zen", apiKey, ...rest } = fields;
    const key = apiKey ?? process.env.OPENCODE_API_KEY;
    const baseURL = tier === "go" ? ZEN_GO_BASE_URL : ZEN_BASE_URL;
    // No key → anonymous free tier (blank Authorization); paid models need a key.
    super({
      ...rest,
      apiKey: key ?? "anonymous",
      configuration: key
        ? { baseURL }
        : { baseURL, defaultHeaders: { Authorization: "" } },
    });
  }
}
