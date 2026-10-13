import { AssemblyAI } from "assemblyai";

import * as config from "./config.js";

const client = new AssemblyAI({ apiKey: config.assemblyaiApiKey });

export async function transcribe(audioBuffer, keyTerms) {
  // Transcribe an audio clip verbatim and return the spoken text.
  const transcript = await client.transcripts.transcribe(
    {
      audio: audioBuffer,
      speech_models: config.speechModels,
      keyterms_prompt: keyTerms,
      punctuate: false, // verbatim — the LLM owns punctuation
      format_text: false,
    },
    { pollingInterval: 300 }, // default 3s is dead wait on short clips
  );

  if (transcript.status === "error") {
    throw new Error(transcript.error);
  }

  return (transcript.text || "").trim();
}
