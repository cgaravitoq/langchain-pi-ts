export interface ModelOverride {
  readonly exclude?: readonly string[];
  readonly add?: readonly string[];
  longContext?: boolean;
  disableEffort?: boolean;
  // Opus 4.8/4.7 require thinking:{type:"adaptive"} + output_config.effort;
  // a manual budget_tokens is rejected with a 400 on these models.
  adaptiveThinking?: boolean;
}

export interface ModelConfig {
  ccVersion: string;
  readonly baseBetas: readonly string[];
  readonly longContextBetas: readonly string[];
  readonly modelOverrides: Readonly<Record<string, ModelOverride>>;
}

export const config: ModelConfig = {
  ccVersion: "2.1.112",
  baseBetas: [
    "claude-code-20250219",
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "prompt-caching-scope-2026-01-05",
    "context-management-2025-06-27",
    "advisor-tool-2026-03-01",
  ],
  longContextBetas: [
    "context-1m-2025-08-07",
    "interleaved-thinking-2025-05-14",
  ],
  // Insertion order matters: getModelOverride returns the first key that is a
  // substring of the lowercased model id.
  modelOverrides: {
    haiku: {
      exclude: ["interleaved-thinking-2025-05-14"],
      disableEffort: true,
    },
    "4-6": {
      longContext: true,
      add: ["effort-2025-11-24"],
    },
    "4-7": {
      longContext: true,
      add: ["effort-2025-11-24"],
      adaptiveThinking: true,
    },
    "4-8": {
      longContext: true,
      add: ["effort-2025-11-24"],
      adaptiveThinking: true,
    },
  },
};

export function getModelOverride(modelId: string): ModelOverride | null {
  const lower = modelId.toLowerCase();
  for (const [pattern, override] of Object.entries(config.modelOverrides)) {
    if (lower.includes(pattern)) return override;
  }
  return null;
}

export function computeBetas(modelId: string): string[] {
  const override = getModelOverride(modelId);
  let betas = [...config.baseBetas];
  if (override?.longContext) betas = [...betas, ...config.longContextBetas];
  if (override?.exclude)
    betas = betas.filter((b) => !override.exclude!.includes(b));
  if (override?.add) betas = [...betas, ...override.add];
  return Array.from(new Set(betas));
}

export const LONG_CONTEXT_BETA = "context-1m-2025-08-07";

// The 1M-context beta classifies the request as long-context, which the Claude
// Code subscription bills against extra credits; keep it opt-in.
export function requestBetas(modelId: string, longContext: boolean): string[] {
  const betas = computeBetas(modelId);
  return longContext ? betas : betas.filter((b) => b !== LONG_CONTEXT_BETA);
}
