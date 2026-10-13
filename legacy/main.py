import os
import sys

import config
import keyterms
from stt import listen
from llm import correct, suggestKeyterms, proseFormats

languages = {
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".c": "C",
    ".cpp": "C++",
    ".rb": "Ruby",
    ".sh": "Bash",
    ".txt": "plain text",
    ".md": "Markdown",
}


def showTail(path, lineCount=15):
    lines = open(path).read().splitlines()
    start = max(0, len(lines) - lineCount)

    if start > 0:
        print(f"   ... ({start} lines above)")

    lineNumber = start + 1
    for line in lines[start:]:
        print(f"   {lineNumber:>3} │ {line}")
        lineNumber += 1


def main():
    config.requireKeys()

    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        path = "draft.py"

    extension = os.path.splitext(path)[1]
    lang = languages.get(extension, "Python")

    open(path, "a").close()  # create the file if it does not exist yet

    sticky = keyterms.loadSticky(path)
    if not sticky and os.path.getsize(path) > 0:
        print("   seeding keyterms from file…")
        sticky = suggestKeyterms(open(path).read(), lang)
        keyterms.saveSticky(path, sticky)

    print(f"🎙  Speak-to-code > {path}  ({lang})")
    print("   Speak a line, review it, confirm. Ctrl-C to quit.\n")

    while True:
        fileText = open(path).read()
        terms = keyterms.build(fileText, sticky)

        print(f"Press Enter to start talking...  ({len(terms)}/{config.maxKeyterms} keyterms)")
        input()

        transcript = listen(terms)
        if not transcript:
            print("     (nothing heard)\n")
            continue

        print(f'    heard: "{transcript}"')

        code = correct(transcript, fileText, lang)

        if lang in proseFormats:
            label = "text"
        else:
            label = "code"

        print(f"     {label}:")
        for line in code.splitlines():
            print(f"        {line}")

        choice = input("[Enter] insert - [r] redo - [q] quit >> ").strip().lower()
        if choice == "q":
            break
        if choice == "r":
            print()
            continue

        with open(path, "a") as appendFile:
            appendFile.write(code + "\n")

        print()
        showTail(path)
        print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye")
