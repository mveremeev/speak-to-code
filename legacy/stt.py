import os
import wave
import tempfile
import threading

import sounddevice as sd
import assemblyai as aai

import config

aai.settings.api_key = config.assemblyaiApiKey
# SDK polls for completion; default is every 3s, which is pure dead wait on short
# clips. Tighten it so we get the result as soon as it's actually ready.
aai.settings.polling_interval = 0.3


def transcribe(audioPath, keyTerms):
    """Transcribe an audio file verbatim and return the spoken text."""
    transcriptionConfig = aai.TranscriptionConfig(
        speech_models=config.speechModels,
        keyterms_prompt=keyTerms,
        punctuate=False,    # verbatim — the LLM owns punctuation
        format_text=False,
    )
    transcriber = aai.Transcriber(config=transcriptionConfig)
    transcript = transcriber.transcribe(audioPath)

    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(transcript.error)

    if transcript.text is None:
        return ""
    return transcript.text.strip()


def _record():
    """CLI push-to-talk: capture PCM16 audio until Enter is pressed, return raw bytes."""
    chunks = []
    stop = threading.Event()

    def loop():
        with sd.RawInputStream(
            samplerate=config.sampleRate,
            blocksize=1600,
            channels=1,
            dtype="int16",
        ) as mic:
            while not stop.is_set():
                data, _ = mic.read(1600)
                chunks.append(bytes(data))

    worker = threading.Thread(target=loop)
    worker.start()
    input("   ⏺  recording — press Enter to stop ")
    stop.set()
    worker.join()

    return b"".join(chunks)


def _writeWav(audio):
    wavPath = os.path.join(tempfile.gettempdir(), "speak2code.wav")
    with wave.open(wavPath, "wb") as wavFile:
        wavFile.setnchannels(1)
        wavFile.setsampwidth(2)
        wavFile.setframerate(config.sampleRate)
        wavFile.writeframes(audio)
    return wavPath


def listen(keyTerms):
    """CLI entry: record one utterance from the mic, transcribe it, return the text."""
    audio = _record()
    if not audio:
        return ""
    wavPath = _writeWav(audio)
    return transcribe(wavPath, keyTerms)
