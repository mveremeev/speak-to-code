import * as config from "./config.js";

// Strict JSON schema: OpenRouter constrains the model to exactly this shape, so
// the reply can't be prose, fences, or a half-formed edit. All fields are
// required (the schema can't make them conditional) — unused ones are null / "".
const editsSchema = {
  name: "edits",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["insert", "replace", "delete", "indent"] },
            start: { type: ["integer", "null"] },
            end: { type: ["integer", "null"] },
            code: { type: "string" },
            level: { type: ["integer", "null"] },
            delta: { type: ["integer", "null"] },
          },
          required: ["action", "start", "end", "code", "level", "delta"],
        },
      },
    },
    required: ["edits"],
  },
};

// Every provider gets the schema; it's what keeps replies from being prose.
const responseFormat = { type: "json_schema", json_schema: editsSchema };

// Reasoning effort is now driven by the toolbar slider; per-model routing lives
// on the model entry in config.js. Nothing else is provider-wide.

// Output formats that are prose, not code — dictation gets cleaned up, not compiled.
const proseFormats = new Set(["plain text", "Markdown"]);

// Shared protocol: the file is shown with line numbers, and every reply is a
// JSON array of edits. JSON lets multi-line code live in a single escaped string
// and lets one reply carry several edits without any delimiter guesswork.
const editProtocol = `The FILE below is shown with line numbers (1-based, matching the editor).
Decide the edit(s) the speaker wants and reply as {"edits":[ ... ]}. Every edit
object has all six fields — set the ones you don't use to null (start/end/level/
delta) or "" (code):

  insert at the cursor:   {"action":"insert","start":null,"end":null,"code":"...","level":L,"delta":null}
  insert before line N:   {"action":"insert","start":N,"end":null,"code":"...","level":L,"delta":null}
  replace lines A..B:     {"action":"replace","start":A,"end":B,"code":"...","level":L,"delta":null}
  delete lines A..B:      {"action":"delete","start":A,"end":B,"code":"","level":null,"delta":null}
  indent lines A..B:      {"action":"indent","start":A,"end":B,"code":"","level":null,"delta":N}

INDENTATION — "level" is how many levels deep the code sits, and it is yours to
decide. 0 is column 0, 1 is one level in, and so on. You can see the FILE's real
indentation in the window below, so work out where the line BELONGS. Two cases,
and both come up constantly:

- Going IN: if the CURSOR line opens a block (ends with ":"), the dictated code
  is normally that block's first body line — one level deeper than the cursor
  line. After "    for _ in range(n):" at level 1, the body is level 2.
- Coming OUT: if the line finishes the block it follows, step back out. A
  "return" that ends a loop belongs at the function's level, not the loop's; a
  new "def" at top level goes back to 0.

Set "level" for the FIRST line of "code". Inside a multi-line block, indent the
remaining lines relative to that first line, which you write at column 0.

Rules:
- Default to insert-at-cursor (start null) when the speaker just dictates code.
- Use start/end only when they name a target ("replace line 7", "delete lines 3
  to 5"). For a single line set end equal to start.
- For "replace", "code" is the full rewritten line(s) with the change applied.
- To add a blank line, use "insert" with code "". For several blank lines, put
  the newlines in code.
- "indent" shifts lines start..end by "delta" levels: +1 indents one level, -2
  dedents two. Use it for "indent this", "move it out a level", etc.
- "code" is raw text; never put line numbers in it.
- One reply can carry several edits for several lines — list them all.
- Ignore filler and thinking-aloud ("um", "uh", "like", false starts) — never
  let them become part of an identifier. On a self-correction ("five, no, six")
  keep only the final intent.`;

const codeInstruction = `The "code" field is real {lang} the speaker dictated. They narrate identifiers
naturally with punctuation left out — you insert all punctuation, brackets,
quotes, colons and operators. Resolve loose identifiers against the FILE: reuse
existing names and match their casing ("my dir" -> an existing \`myDir\`).
Spelled-out values become literals ("ten" -> 10).

Examples:
  (cursor at top level) with open myDir r as file
    {"edits":[{"action":"insert","start":null,"end":null,"code":"with open(myDir, \\"r\\") as file:","level":0,"delta":null}]}

  (cursor inside "for _ in range(n):" in a function) return prev
    -> the loop is done; this belongs at the FUNCTION's level, not the loop's
    {"edits":[{"action":"insert","start":null,"end":null,"code":"return prev","level":1,"delta":null}]}

  (cursor just after "def load(path):" at top level) open the file and read it
    -> first line of a function body, one level in
    {"edits":[{"action":"insert","start":null,"end":null,"code":"with open(path) as f:\\n    return f.read()","level":1,"delta":null}]}

  replace line 4 with x equals a times b plus three
    {"edits":[{"action":"replace","start":4,"end":4,"code":"x = a * b + 3","level":0,"delta":null}]}

  delete lines 7 to 9
    {"edits":[{"action":"delete","start":7,"end":9,"code":"","level":null,"delta":null}]}

  add a blank line before line 3
    {"edits":[{"action":"insert","start":3,"end":null,"code":"","level":null,"delta":null}]}

  indent line 5, then dedent lines 8 to 10
    {"edits":[{"action":"indent","start":5,"end":5,"code":"","level":null,"delta":1},{"action":"indent","start":8,"end":10,"code":"","level":null,"delta":-1}]}`;

const proseInstruction = `Prose has no nesting, so "level" is always 0.

The "code" field is the speaker's dictation cleaned into well-formed {lang}:
fix punctuation, capitalization and obvious transcription slips, but keep their
words and meaning — do not summarize, shorten or invent. For Markdown, add light
formatting only where clearly implied.`;

function fillLang(template, lang) {
  return template.replaceAll("{lang}", lang);
}

// Show the model a bounded window of the file, each line prefixed with its real
// (absolute) editor line number so it can target lines the user can see.
function numberedWindow(fileText, cursorLine, maxLines) {
  const lines = fileText.split("\n");
  const total = lines.length;

  let start = 0;
  let end = total;
  if (total > maxLines) {
    // Default to the end of the file when we don't know the cursor (e.g. prose).
    if (cursorLine == null) cursorLine = total;
    const after = Math.floor(maxLines * 0.15);
    const before = maxLines - after;
    start = Math.max(0, cursorLine - before);
    end = Math.min(total, cursorLine + after);
  }

  const out = [];
  for (let i = start; i < end; i++) {
    out.push((i + 1) + "\t" + lines[i]);
  }
  return out.join("\n");
}

// Pull the JSON array/object out of a reply, tolerating stray prose or code
// fences around it. Returns null when there are no brackets to parse.
function extractJson(text) {
  const firstArray = text.indexOf("[");
  const firstObject = text.indexOf("{");

  let open = -1;
  if (firstArray === -1) open = firstObject;
  else if (firstObject === -1) open = firstArray;
  else open = Math.min(firstArray, firstObject);
  if (open === -1) return null;

  const close = text[open] === "[" ? "]" : "}";
  const last = text.lastIndexOf(close);
  if (last <= open) return null;

  return text.slice(open, last + 1);
}

// Turn the reply into a list of edits. If it parses to edits, use them. If the
// reply has no brackets at all the model gave plain text, so insert it at the
// cursor (the safe default). Anything in between is a broken structured reply —
// throw, so the caller refuses it rather than dumping garbage into the file.
function parseEdits(text) {
  text = text.trim();

  const json = extractJson(text);
  if (json) {
    const parsed = JSON.parse(json);
    // Normally {"edits":[...]}; tolerate a bare array or single object too.
    const list = Array.isArray(parsed) ? parsed : parsed.edits || [parsed];
    const edits = list.filter((edit) => edit && edit.action);
    if (edits.length > 0) return edits;
  }

  if (text.includes("[") || text.includes("{")) {
    throw new Error("couldn't read the model's reply — try again");
  }
  return [{ action: "insert", code: text }];
}

export async function correct(
  transcript,
  fileText,
  lang = "Python",
  cursorLine = null,
  modelId = null,
  effort = null,
) {
  const target = config.resolveModel(modelId, effort);

  const instruction = proseFormats.has(lang) ? proseInstruction : codeInstruction;
  const systemMessage = fillLang(editProtocol + "\n\n" + instruction, lang);

  const context = numberedWindow(fileText, cursorLine, config.contextLines);
  const cursorInfo = cursorLine != null ? cursorLine + 1 : "end of file";

  const userMessage =
    "FILE:\n```\n" + context + "\n```\n\n" +
    "CURSOR is on line " + cursorInfo + ".\n\n" +
    "SPOKEN: " + transcript + "\n\n" +
    "Reply with the JSON edits:";

  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: target.model,
      temperature: target.temperature,
      response_format: responseFormat,
      ...(target.reasoning ? target.encodeReasoning(target.reasoning) : {}),
      ...(target.extra || {}),
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`${target.label} ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return parseEdits(data.choices[0].message.content);
}
