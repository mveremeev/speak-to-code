import os


def _loadEnv(path=".env"):
    """Tiny no-dependency .env loader. Real environment variables win over the file."""
    if not os.path.exists(path):
        return

    for line in open(path):
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_loadEnv()

assemblyaiApiKey = os.environ.get("ASSEMBLYAI_API_KEY", "")
openrouterApiKey = os.environ.get("OPENROUTER_API_KEY", "")

# Swap this one string to change models later, e.g. "anthropic/claude-sonnet-4.6".
llmModel = "openai/gpt-oss-120b"

sampleRate = 16_000

# Pre-recorded: ordered fallback list (tries the first, falls back to the next).
speechModels = ["universal-3-pro", "universal-2"]

# Pre-recorded U3 Pro allows up to 1000 keyterms (U2 fallback caps at 200).
maxKeyterms = 1000


def requireKeys():
    missing = []
    if not assemblyaiApiKey:
        missing.append("ASSEMBLYAI_API_KEY")
    if not openrouterApiKey:
        missing.append("OPENROUTER_API_KEY")

    if missing:
        raise SystemExit("Set env vars before running: " + ", ".join(missing))
