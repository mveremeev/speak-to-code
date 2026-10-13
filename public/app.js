const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  mode: "python",
  theme: "dracula",
  lineNumbers: true,
  indentUnit: 4,
  tabSize: 4,
});
editor.setValue("# speak some code…\n");
editor.clearHistory();

const mic = document.getElementById("mic");
const typed = document.getElementById("typed");
const typeBar = document.getElementById("type-bar");
const progress = document.getElementById("mic-progress");
const filenameEl = document.getElementById("filename");
const langSelect = document.getElementById("lang-select");
const modelSelect = document.getElementById("model-select");
const effortWrap = document.getElementById("effort");
const effortRange = document.getElementById("effort-range");
const effortLabel = document.getElementById("effort-label");
const openBtn = document.getElementById("open-btn");
const saveBtn = document.getElementById("save-btn");
const saveAsBtn = document.getElementById("saveas-btn");
const filePicker = document.getElementById("file-picker");

let currentFilename = "draft.py";
let fileHandle = null;
setLanguage("Python");
let mediaRecorder = null;
let chunks = [];
let recording = false;

const langMap = {
  py: "Python", js: "JavaScript", ts: "TypeScript", go: "Go",
  rs: "Rust", java: "Java", c: "C", cpp: "C++",
  rb: "Ruby", sh: "Bash", txt: "plain text", md: "Markdown",
};

const modeMap = {
  py: "python", js: "javascript", ts: "application/typescript", go: "go",
  rs: "rust", java: "text/x-java", c: "text/x-csrc", cpp: "text/x-c++src",
  rb: "ruby", sh: "shell", md: "markdown", json: "javascript",
  html: "htmlmixed", css: "css",
};

const langToMode = {
  Python: "python", JavaScript: "javascript", TypeScript: "application/typescript",
  Go: "go", Rust: "rust", Java: "text/x-java", C: "text/x-csrc",
  "C++": "text/x-c++src", Ruby: "ruby", Bash: "shell",
  "plain text": null, Markdown: "markdown",
};

for (const lang of [...new Set(Object.values(langMap))].sort()) {
  const opt = document.createElement("option");
  opt.value = lang;
  opt.textContent = lang;
  langSelect.appendChild(opt);
}

// The server owns the model list (it knows which provider keys are set); the
// browser just renders it and remembers the picks across reloads.
const modelKey = "speak-to-code.model";
const effortKey = (id) => "speak-to-code.effort." + id;

let modelInfo = {}; // id -> { levels, reasoning }

// Reasoning effort is remembered per model, not globally: "high" on Mercury and
// "high" on Gemini are different amounts of waiting, so the right setting for
// one is rarely the right setting for the other.
function syncEffort() {
  const info = modelInfo[modelSelect.value];
  const levels = (info && info.levels) || [];

  // A model with no exposed levels gets no slider at all.
  effortWrap.hidden = levels.length === 0;
  if (effortWrap.hidden) return;

  const saved = localStorage.getItem(effortKey(modelSelect.value));
  const current = levels.includes(saved) ? saved : info.reasoning;

  effortRange.max = String(levels.length - 1);
  effortRange.value = String(Math.max(0, levels.indexOf(current)));
  effortLabel.textContent = levels[effortRange.value];
}

function currentEffort() {
  const info = modelInfo[modelSelect.value];
  const levels = (info && info.levels) || [];
  return levels[effortRange.value] || "";
}

async function loadModels() {
  const response = await fetch("/models");
  const { models, default: fallback } = await response.json();

  for (const model of models) {
    modelInfo[model.id] = { levels: model.levels, reasoning: model.reasoning };
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.label;
    modelSelect.appendChild(opt);
  }

  modelSelect.value = localStorage.getItem(modelKey) || fallback;
  // A remembered model can vanish (key removed, entry renamed) — fall back.
  if (!modelSelect.value) modelSelect.value = fallback;
  syncEffort();
}

modelSelect.addEventListener("change", () => {
  localStorage.setItem(modelKey, modelSelect.value);
  syncEffort();
});

effortRange.addEventListener("input", () => {
  const effort = currentEffort();
  effortLabel.textContent = effort;
  localStorage.setItem(effortKey(modelSelect.value), effort);
});

loadModels();

function guessLanguage(filename) {
  const ext = filename.split(".").pop();
  return langMap[ext] || "";
}

function guessMode(filename) {
  const ext = filename.split(".").pop();
  return modeMap[ext] || "python";
}

function setLanguage(lang) {
  if (!lang) return;
  langSelect.value = lang;
  if (!langSelect.value) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
    langSelect.value = lang;
  }
}

async function openFile() {
  try {
    const [handle] = await window.showOpenFilePicker();
    fileHandle = handle;
    const file = await handle.getFile();
    currentFilename = file.name;
    filenameEl.textContent = currentFilename;
    editor.setValue(await file.text());
    editor.clearHistory();
    editor.setOption("mode", guessMode(currentFilename));
    setLanguage(guessLanguage(currentFilename));
  } catch {
    filePicker.click();
  }
}

async function saveFile() {
  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(editor.getValue());
    await writable.close();
  } else {
    saveAsFile();
  }
}

async function saveAsFile() {
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: currentFilename });
    fileHandle = handle;
    const writable = await handle.createWritable();
    await writable.write(editor.getValue());
    await writable.close();
  } catch {
    const blob = new Blob([editor.getValue()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = currentFilename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

langSelect.addEventListener("change", () => {
  const mode = langToMode[langSelect.value];
  editor.setOption("mode", mode);
});

openBtn.addEventListener("click", openFile);
saveBtn.addEventListener("click", saveFile);
saveAsBtn.addEventListener("click", saveAsFile);

filePicker.addEventListener("change", async () => {
  const file = filePicker.files[0];
  if (!file) return;
  currentFilename = file.name;
  filenameEl.textContent = currentFilename;
  editor.setValue(await file.text());
  editor.clearHistory();
  editor.setOption("mode", guessMode(currentFilename));
  setLanguage(guessLanguage(currentFilename));
  filePicker.value = "";
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    if (e.shiftKey) saveAsFile();
    else saveFile();
  }
});

mic.addEventListener("click", () => {
  if (recording) {
    stopRecording();
  } else {
    mic.classList.add("waiting");
    startRecording();
  }
});

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
    mediaRecorder.addEventListener("stop", sendAudio);
    mediaRecorder.start();

    recording = true;
    mic.classList.remove("waiting");
    mic.classList.add("recording");
    vibrate(30); // recording started
  } catch {
    mic.classList.remove("waiting");
  }
}

function stopRecording() {
  recording = false;
  mic.classList.remove("recording");
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  vibrate(30); // recording stopped
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Haptic feedback on mobile; a no-op where the API is unsupported (e.g. desktop).
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function clampLine(line) {
  return Math.max(0, Math.min(line, editor.lastLine()));
}

// Indentation is the MODEL's call: it reports how many levels deep a block sits
// and the editor decides what a level looks like. In Python indentation is
// semantics, not formatting, so only the thing that understands the code can
// place it — CodeMirror's "smart" indent goes a level deeper after `for ...:`
// and never comes back out, which is how `return prev` ended up inside the loop.

const indentUnit = () => " ".repeat(editor.getOption("indentUnit"));
const levelIndent = (level) => indentUnit().repeat(Math.max(0, level));
const leadingWhitespace = (text) => text.match(/^[ \t]*/)[0];

// Strip the block's common leading whitespace so it starts at column 0, leaving
// every line's *relative* depth untouched.
function dedent(lines) {
  const depths = lines.filter((l) => l.trim()).map((l) => leadingWhitespace(l).length);
  const common = depths.length > 0 ? Math.min(...depths) : 0;
  return lines.map((line) => line.slice(common));
}

// Fallback only, for when the model returns a null level: match the last real
// line above, one level deeper if it opened a block. This is the guess that
// can't see dedents — never let it override an explicit level.
function indentAfterContext(line) {
  for (let above = line - 1; above >= 0; above--) {
    const text = editor.getLine(above);
    if (!text || !text.trim()) continue;
    const indent = leadingWhitespace(text);
    return /[:{[(]\s*$/.test(text) ? indent + indentUnit() : indent;
  }
  return "";
}

// Replacing or inserting before a real line adopts that line's own level;
// otherwise fall back to the surrounding context.
function anchorIndent(line) {
  const text = editor.getLine(line);
  if (text && text.trim()) return leadingWhitespace(text);
  return indentAfterContext(line);
}

// Shift a whole block to `base`, preserving its internal shape. Blank lines stay
// blank rather than collecting trailing whitespace.
function placeBlock(code, base) {
  return dedent(code.split("\n"))
    .map((line) => (line.trim() ? base + line : ""))
    .join("\n");
}

function focusLine(line) {
  const target = clampLine(line);
  editor.setCursor({ line: target, ch: editor.getLine(target).length });
  editor.scrollIntoView({ line: target, ch: 0 }, 80);
  editor.focus();
}

// Sweep a highlight across the target lines, hold ~0.2s, then clear — the
// "selecting" beat before an edit lands.
async function highlightLines(start, end) {
  for (let line = start; line <= end; line++) {
    editor.addLineClass(line, "background", "selecting");
  }
  editor.scrollIntoView({ line: start, ch: 0 }, 80);
  await sleep(200);
  for (let line = start; line <= end; line++) {
    editor.removeLineClass(line, "background", "selecting");
  }
}

// Brief flash on the lines that just changed, so the result is easy to spot.
function flashLines(start, count) {
  const end = clampLine(start + Math.max(count, 1) - 1);
  // Track line HANDLES, not numbers: a later edit in the same batch can shift
  // these lines before the timeout fires, and number-based removal would then
  // clear the wrong line and leave the flash stuck on this one.
  const handles = [];
  for (let line = start; line <= end; line++) {
    handles.push(editor.addLineClass(line, "background", "edited"));
  }
  setTimeout(() => {
    for (const handle of handles) {
      editor.removeLineClass(handle, "background", "edited");
    }
  }, 500);
}

// Shift lines start..end by `delta` indent levels (+ indents, - dedents),
// without smart-reindenting — this is the user explicitly overriding layout.
function indentLines(start, end, delta) {
  if (!delta) return;
  const dir = delta > 0 ? "add" : "subtract";
  for (let line = start; line <= end; line++) {
    for (let step = 0; step < Math.abs(delta); step++) {
      editor.indentLine(line, dir);
    }
  }
}

function deleteLines(start, end) {
  if (end >= editor.lastLine()) {
    // The last line has no trailing newline — eat the preceding one instead so
    // we don't leave a blank line behind.
    const from = start > 0
      ? { line: start - 1, ch: editor.getLine(start - 1).length }
      : { line: 0, ch: 0 };
    editor.replaceRange("", from, { line: end, ch: editor.getLine(end).length });
  } else {
    editor.replaceRange("", { line: start, ch: 0 }, { line: end + 1, ch: 0 });
  }
}

// Plain insert at the live cursor — the default when no line is targeted.
function insertCode(edit) {
  const cursor = editor.getCursor();
  const currentLine = editor.getLine(cursor.line) || "";

  // Dictation always lands on its own line. Sitting inside existing content used
  // to splice the new code into the middle of that line.
  const target = currentLine.trim() ? cursor.line + 1 : cursor.line;

  const text = placeBlock(
    (edit.code || "").replace(/\n+$/, ""), // we own the line break; drop the model's
    edit.level != null ? levelIndent(edit.level) : indentAfterContext(target),
  );
  const count = text.split("\n").length;

  if (target > editor.lastLine()) {
    // Past the end of the document, which is where dictation usually sits.
    // CodeMirror clamps an out-of-range position back to the end of the last
    // line, so inserting "text\n" there would splice onto that line instead of
    // starting a new one — carry our own leading break.
    const last = editor.lastLine();
    editor.replaceRange("\n" + text, { line: last, ch: editor.getLine(last).length });
  } else {
    editor.replaceRange(text + "\n", { line: target, ch: 0 });
  }

  flashLines(target, count);
  focusLine(target + count - 1);
}

// Apply a batch of edits. Targeted edits run bottom-up so earlier line numbers
// stay valid as the file shifts; plain cursor inserts go last.
async function applyEdits(edits) {
  const targeted = edits
    .filter((edit) => edit.start != null)
    .sort((a, b) => b.start - a.start);
  const cursorInserts = edits.filter((edit) => edit.start == null);

  for (const edit of targeted) await applyEdit(edit);
  for (const edit of cursorInserts) await applyEdit(edit);
}

// Apply one structured edit from the LLM (insert / replace / delete) with the
// select-then-act animation and focus moved to the edited line.
async function applyEdit(edit) {
  if (edit.action === "insert" && edit.start == null) {
    insertCode(edit);
    return;
  }

  // Keep the unclamped line for inserts: "insert before line 8" in a 7-line file
  // means append after the end, and clamping it to 7 would instead put the code
  // *above* the last line — a whole line off, in the commonest case there is.
  const requested = (edit.start || 1) - 1;
  const start = clampLine(requested);
  const end = clampLine((edit.end || edit.start || 1) - 1);

  await highlightLines(start, Math.max(start, end));

  if (edit.action === "indent") {
    indentLines(start, end, edit.delta || 0);
    flashLines(start, end - start + 1);
    focusLine(start);
    return;
  }

  if (edit.action === "delete") {
    deleteLines(start, end);
    focusLine(start);
    return;
  }

  // The model's level wins; without one, fall back to the target line's own
  // depth (replacing line 7 stays at line 7's level).
  const code = placeBlock(
    (edit.code || "").replace(/\n+$/, ""), // we manage line breaks
    edit.level != null ? levelIndent(edit.level) : anchorIndent(start),
  );
  const count = code.split("\n").length;

  let landed = start;

  if (edit.action === "insert") {
    if (requested > editor.lastLine()) {
      const last = editor.lastLine();
      editor.replaceRange("\n" + code, { line: last, ch: editor.getLine(last).length });
      landed = last + 1;
    } else {
      editor.replaceRange(code + "\n", { line: requested, ch: 0 });
      landed = requested;
    }
  } else {
    editor.replaceRange(
      code,
      { line: start, ch: 0 },
      { line: end, ch: editor.getLine(end).length },
    );
  }

  flashLines(landed, count);
  focusLine(landed + count - 1);
}

// Attach the file context fields every request needs.
function withContext(form) {
  form.append("text", editor.getValue());
  form.append("lang", langSelect.value);
  form.append("cursor", editor.getCursor().line);
  form.append("model", modelSelect.value);
  form.append("effort", currentEffort());
  return form;
}

// POST to /dictate and apply the streamed edits. Works for both spoken audio
// and typed text — the server skips transcription when there's no audio.
async function streamEdits(form) {
  mic.disabled = true;
  progress.classList.add("visible");

  try {
    const response = await fetch("/dictate", { method: "POST", body: form });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (msg.status === "transcribing") {
          progress.textContent = "Transcribing";
        } else if (msg.status === "formatting") {
          progress.textContent = "Formatting";
        } else if (msg.error) {
          progress.textContent = msg.error;
        } else if (msg.edits) {
          await applyEdits(msg.edits);
          vibrate([20, 40, 20]); // code filled in
        }
      }
    }
  } finally {
    progress.classList.remove("visible");
    mic.disabled = false;
  }
}

async function sendAudio() {
  const blob = new Blob(chunks, { type: "audio/webm" });
  const form = withContext(new FormData());
  form.append("audio", blob, "audio.webm");

  mic.classList.remove("recording");
  progress.textContent = "Uploading audio";
  await streamEdits(form);
}

async function sendTyped() {
  const spoken = typed.value.trim();
  if (!spoken) return;

  const form = withContext(new FormData());
  form.append("spoken", spoken);
  typed.value = "";

  progress.textContent = "Formatting";
  await streamEdits(form);
}

typeBar.addEventListener("submit", (event) => {
  event.preventDefault();
  sendTyped();
});
