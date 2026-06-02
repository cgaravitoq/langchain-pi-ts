import { createHash } from "node:crypto";

const BILLING_SALT = "59cf53e54c78";

interface Message {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
}

function extractFirstUserMessageText(messages: Message[]): string {
  const userMsg = messages.find((m) => m.role === "user");
  if (!userMsg) return "";
  const content = userMsg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text" && textBlock.text) {
      return textBlock.text;
    }
  }
  return "";
}

function computeCch(messageText: string): string {
  return createHash("sha256").update(messageText).digest("hex").slice(0, 5);
}

function computeVersionSuffix(messageText: string, version: string): string {
  const sampled = [4, 7, 20]
    .map((i) => (i < messageText.length ? messageText[i] : "0"))
    .join("");
  const input = `${BILLING_SALT}${sampled}${version}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 3);
}

export function buildBillingHeaderValue(
  messages: Message[],
  version: string,
  entrypoint: string,
): string {
  const text = extractFirstUserMessageText(messages);
  const suffix = computeVersionSuffix(text, version);
  const cch = computeCch(text);
  return (
    `x-anthropic-billing-header: ` +
    `cc_version=${version}.${suffix}; ` +
    `cc_entrypoint=${entrypoint}; ` +
    `cch=${cch};`
  );
}
