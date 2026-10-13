import { readFileSync, existsSync } from "node:fs";

function loadEnv(path = ".env") {
  // Tiny no-dependency .env loader. Real environment variables win over the file.
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const splitAt = trimmed.indexOf("=");
    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

export const assemblyaiApiKey = process.env.ASSEMBLYAI_API_KEY || "";
export const openrouterApiKey = process.env.OPENROUTER_API_KEY || "";
export const inceptionApiKey = process.env.INCEPTION_API_KEY || "";

// Every provider here speaks the OpenAI chat-completions shape, so switching
// models is a matter of endpoint + key + which extra body fields are allowed.
// `encodeReasoning` is where they stop agreeing: OpenRouter normalizes effort
// into a `reasoning` object, Inception takes OpenAI's flat `reasoning_effort`.
// Both verified to move real reasoning-token counts and to reject bad values.
const providers = {
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: openrouterApiKey,
    envVar: "OPENROUTER_API_KEY",
    encodeReasoning: (effort) => ({ reasoning: { effort } }),
  },
  inception: {
    url: "https://api.inceptionlabs.ai/v1/chat/completions",
    apiKey: inceptionApiKey,
    envVar: "INCEPTION_API_KEY",
    encodeReasoning: (effort) => ({ reasoning_effort: effort }),
  },
};

// Slider stops, cheapest first. A model can expose a subset (or none, which
// hides the slider) — keep them ordered, the UI indexes into this array.
export const reasoningLevels = ["minimal", "low", "medium", "high"];

// The switcher's menu. `model` is the provider's own model id; `id` is what the
// browser sends back. Add an entry to offer another model — nothing else needs
// to change. Temperature is per-model because providers disagree on the range:
// Mercury only accepts 0.5–1 and silently clamps anything lower. `extra` is
// merged into the request body for that model alone. `levels` lists the
// reasoning stops the model supports and `reasoning` is its default; omit both
// to hide the slider for that model.
export const models = [
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "openrouter",
    model: "openai/gpt-oss-120b",
    temperature: 0.2,
    levels: reasoningLevels,
    reasoning: "low",
    // Pin the fastest hosts that serve this model so OpenRouter can't route us
    // to a slow GPU. Model-specific: Cerebras and Groq don't serve Gemini.
    extra: {
      provider: { order: ["Cerebras", "Groq"], allow_fallbacks: true, require_parameters: true },
    },
  },
  {
    id: "mercury-2",
    label: "Mercury 2 (diffusion)",
    provider: "inception",
    model: "mercury-2",
    temperature: 0.5,
    levels: reasoningLevels,
    reasoning: "low",
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    provider: "openrouter",
    model: "google/gemini-3.6-flash",
    temperature: 0.2,
    levels: reasoningLevels,
    reasoning: "minimal", // already ~5s per line; don't make it think as well
  },
];

export const defaultModel = models[0].id;

// Only models whose provider key is actually set — a missing key hides the
// model from the menu instead of failing at request time.
export function availableModels() {
  return models.filter((entry) => providers[entry.provider].apiKey);
}

// Resolve a model id from the browser into what llm.js needs to make the call.
// Falls back to the default when the id is unknown or its key is missing. An
// effort the model doesn't list is ignored rather than passed through — every
// one of these APIs 400s on an unknown value.
export function resolveModel(id, effort = null) {
  const available = availableModels();
  const entry = available.find((m) => m.id === id) || available[0];
  if (!entry) throw new Error("no LLM provider key is set");

  const levels = entry.levels || [];
  const reasoning = levels.includes(effort) ? effort : entry.reasoning || null;

  return { ...entry, ...providers[entry.provider], reasoning };
}

// Pre-recorded: ordered fallback list (tries the first, falls back to the next).
export const speechModels = ["universal-3-pro", "universal-2"];

// Pre-recorded U3 Pro allows up to 1000 keyterms (U2 fallback caps at 200).
export const maxKeyterms = 1000;

// How many lines of the file to give the LLM as context, windowed around the
// cursor. The model has a large context window, but a tight local window keeps
// latency down and the model's attention on the code that actually matters.
export const contextLines = 200;

export function requireKeys() {
  const missing = [];
  if (!assemblyaiApiKey) missing.push("ASSEMBLYAI_API_KEY");
  // Any one provider key is enough to run; the menu shows whichever are set.
  if (availableModels().length === 0) {
    missing.push([...new Set(models.map((m) => providers[m.provider].envVar))].join(" or "));
  }

  if (missing.length > 0) {
    console.error("Set env vars before running: " + missing.join(", "));
    process.exit(1);
  }
}
