from openai import OpenAI

import config

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=config.openrouterApiKey,
)

#Pin to the fastest providers so or cant route to something slow
extraBody = {
    "reasoning": {"effort": "low"},
    "provider": {"order": ["Cerebras", "Groq"], "allow_fallbacks": True},
}

systemPrompt = """You turn a programmer's spoken dictation into real {lang} code.

The speaker narrates the way code sounds in their head: identifiers spoken
naturally, with punctuation and structure left out. Write the exact line(s) of
{lang} they mean.

Rules:
- Output ONLY code. No explanation, no markdown fences.
- Insert all punctuation, brackets, quotes, colons and operators yourself.
- Resolve loose identifiers against the CURRENT FILE: reuse existing names and
  match their casing (camelCase / snake_case). "my dir" -> an existing `myDir`.
- Spelled-out values become literals: "ten" -> 10; "r" as an open() arg -> "r".
- Match the file's indentation. If unsure, use no leading indent.

Examples:
  with open myDir r as file        ->  with open(myDir, "r") as file:
  x equals a times b plus three    ->  x = a * b + 3
  for i in range ten               ->  for i in range(10):
  if name equals equals main       ->  if __name__ == "__main__":
  return self dot value            ->  return self.value
  print f string hello name        ->  print(f"hello {{name}}")
"""

#not code, dictation gets cleaned up
proseFormats = {"plain text", "Markdown"}

prosePrompt = """You clean up a person's spoken dictation into well-formed {lang}.

Fix punctuation, capitalization, and obvious transcription slips. Keep their
words and meaning — do not summarize, shorten, or invent content. For Markdown,
apply light formatting (headings, lists, emphasis) only where the speaker
clearly implies it.

Output only the text. No explanation, no code fences.
"""


def suggestKeyterms(fileText, lang="Python"):
    """One-time seed: terms STT would likely mishear, predicted from the file."""
    instruction = (
        f"List proper nouns a speech-to-text model would likely mishear in this "
        f"{lang} project: library names, APIs, domain terms, key identifiers. "
        f"Reply with a comma-separated list and nothing else."
    )

    response = client.chat.completions.create(
        model=config.llmModel,
        temperature=0.2,
        extra_body=extraBody,
        messages=[
            {"role": "system", "content": instruction},
            {"role": "user", "content": fileText or "(empty file)"},
        ],
    )

    raw = response.choices[0].message.content
    raw = raw.replace("\n", ",")

    terms = []
    for piece in raw.split(","):
        piece = piece.strip()
        if piece:
            terms.append(piece)

    return terms[:config.maxKeyterms]


def _stripFences(text):
    text = text.strip()
    if not text.startswith("```"):
        return text

    body = text[3:].split("```")[0]
    if "\n" in body:
        firstLine, rest = body.split("\n", 1)
        if firstLine.strip().isalpha():    # drop a leading language tag line
            return rest.strip("\n")

    return body.strip("\n")


def correct(transcript, fileText, lang="Python"):
    if lang in proseFormats:
        systemMessage = prosePrompt.format(lang=lang)
    else:
        systemMessage = systemPrompt.format(lang=lang)

    userMessage = (
        f"CURRENT FILE:\n```\n{fileText}\n```\n\n"
        f"SPOKEN: {transcript}\n\n"
        f"Output:"
    )

    response = client.chat.completions.create(
        model=config.llmModel,
        temperature=0.2,
        extra_body=extraBody,
        messages=[
            {"role": "system", "content": systemMessage},
            {"role": "user", "content": userMessage},
        ],
    )

    return _stripFences(response.choices[0].message.content)
