# Speak-to-code (laptop prototype)

Speak a line the way it sounds in your head — `"with open myDir r as file"` —
and it lands in your file as `with open(myDir, "r") as file:`.

Pipeline: **mic → AssemblyAI STT (verbatim) → gpt-oss-120b correction → append to file.**
Push-to-talk: you hold the floor (Enter to start, Enter to stop), the whole
utterance is sent as one request — no streaming, no WebSocket.
The STT just captures the literal words; the LLM inserts all the syntax, using
your current file as context to resolve identifier names and casing.

## Setup

```bash
pip install -r requirements.txt
# keys live in .env (already created). Or export them instead.
```

If `import sounddevice` ever fails with a "PortAudio library not found" error,
run `brew install portaudio` — but the pip wheel usually bundles it, so you
likely won't need to.

## Run

```bash
python main.py myfile.py         # defaults to draft.py
```

Press Enter to start talking, Enter again to stop. Review the generated line,
then Enter to insert / `r` to redo / `q` to quit.

## Files

- `config.py`   — API keys + the model registry (see "Models" below).
- `stt.py`      — records the utterance, sends it to AssemblyAI for transcription.
- `keyterms.py` — builds/persists the keyterm list fed to the transcriber.
- `llm.py`      — sends transcript + file to gpt-oss-120b, returns the corrected code.
- `main.py`     — the talk → review → append loop.

## Notes

- STT is pre-recorded (one request per utterance), so each line takes a couple
  seconds round-trip — fine for push-to-talk dictation.
- Context is the whole file, cursor = end of file (it appends). Line-targeted
  insertion is the obvious next step.

## Indentation

The model decides indentation, not the editor. Each edit carries a `level` — how
many levels deep the code sits — and the editor decides what a level looks like
(`indentUnit`), so the model never touches whitespace.

This is not a stylistic choice. In Python, indentation *is* semantics: it's the
equivalent of braces. CodeMirror's "smart" indent can see that `for x:` opens a
block, but nothing in the syntax tells it where a block *ends*, so it goes one
level in and never comes back out — which is how a dictated `return prev` landed
inside the loop it was meant to terminate. Only the model knows what the line
means, so only the model can place it.

Inside a multi-line block the model indents relative to its own first line, and
the editor shifts the block as a unit; relative shape is never re-derived.

## Models

The toolbar has a model switcher; your pick is remembered in localStorage.

| Model | Provider | Notes |
| --- | --- | --- |
| GPT-OSS 120B (default) | OpenRouter | Pinned to Cerebras/Groq. Fastest measured, ~0.4–1.5s. |
| Mercury 2 | Inception Labs | Diffusion LLM (dLLM), 128k context. ~0.8–1.5s. |
| Gemini 3.6 Flash | OpenRouter | 1M context, but ~5s round trip — too slow for line-by-line. |

Add a model by appending an entry to `models` in `src/config.js` — id, label,
provider, the provider's own model id, and a temperature. Optional `extra` is
merged into the request body for that model alone (that's where the Cerebras
routing pin lives, since it's specific to GPT-OSS — Cerebras and Groq don't
serve Gemini). If its provider isn't in the `providers` table yet, add the
endpoint + key env var there too. Nothing else changes: the server serves the
list at `GET /models` and the browser renders whatever comes back.

### Thinking level

The slider next to the model picker sets reasoning effort —
`minimal / low / medium / high` — and is remembered **per model**, since "high"
costs a different amount of waiting on each one. Roughly, on one dictated line:

| | minimal | high |
| --- | --- | --- |
| GPT-OSS 120B | 0.88s | 1.90s |
| Mercury 2 | 0.95s | 2.09s |

Minimal is right for straight dictation, where the model is only inserting
punctuation and has nothing to reason about. It starts to matter when you
dictate intent rather than syntax: on "parse the config file and return a dict
of settings handling missing keys", GPT-OSS wrote 3 lines at minimal and 13 at
high. Which is a reason to reach for the slider, and equally a reason not to —
a model that writes more than you specified is a model inventing.

A model that exposes no `levels` simply has no slider.

Keys live in `.env`: `OPENROUTER_API_KEY`, `INCEPTION_API_KEY`. A model whose
provider key is missing is simply hidden from the menu, so you only need keys
for the models you actually use.

Two provider quirks worth knowing, both handled in `src/llm.js`:

- The OpenRouter-only routing fields (`provider`, `reasoning`) are scoped to
  OpenRouter — sending them to a direct provider is a 400.
- Mercury only accepts temperature in `[0.5, 1]` and silently clamps anything
  lower, so temperature is per-model rather than global.

Set `PORT` to run the server somewhere other than 8000.
