import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import * as config from "./config.js";
import { build } from "./keyterms.js";
import { transcribe } from "./stt.js";
import { correct } from "./llm.js";

config.requireKeys();

const app = new Hono();

// The model menu, so the browser never has to know provider names or keys.
app.get("/models", (c) =>
  c.json({
    models: config.availableModels().map(({ id, label, levels, reasoning }) => ({
      id,
      label,
      levels: levels || [],
      reasoning: reasoning || null,
    })),
    default: config.resolveModel(null).id,
  }),
);

// Record on the client, transcribe + correct here (keys stay server-side).
app.post("/dictate", async (c) => {
  const body = await c.req.parseBody();
  const audio = body["audio"];
  const spoken = body["spoken"] || ""; // typed input — skips transcription
  const text = body["text"] || "";
  const lang = body["lang"] || "Python";
  const cursorLine = body["cursor"] != null ? Number(body["cursor"]) : null;
  const model = body["model"] || null;
  const effort = body["effort"] || null;

  // Keyterms bias the STT toward every identifier in the file, so use the whole
  // text here even though the LLM only sees a window around the cursor.
  const keyTerms = build(text);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Typed text is already the transcript; audio needs transcribing first.
        let heard = spoken.trim();
        if (audio && typeof audio.arrayBuffer === "function") {
          controller.enqueue(encoder.encode(JSON.stringify({ status: "transcribing" }) + "\n"));
          const audioBuffer = Buffer.from(await audio.arrayBuffer());
          heard = await transcribe(audioBuffer, keyTerms);
        }

        if (!heard) {
          controller.enqueue(encoder.encode(JSON.stringify({ heard: "" }) + "\n"));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(JSON.stringify({ status: "formatting" }) + "\n"));

        const edits = await correct(heard, text, lang, cursorLine, model, effort);
        controller.enqueue(encoder.encode(JSON.stringify({ heard, edits }) + "\n"));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: err.message }) + "\n"));
        controller.close();
      }
    },
  });

  return c.body(stream, 200, { "Content-Type": "application/x-ndjson" });
});

// Everything else is the static editor page.
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 8000 }, (info) => {
  console.log(`http://localhost:${info.port}`);
});
