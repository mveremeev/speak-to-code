import os
import re
import json
from collections import Counter

import config

identifierPattern = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,49}")

# Words too generic to waste a keyterm slot on.
stopWords = {
    "self", "True", "False", "None", "and", "for", "in", "if", "is",
    "as", "of", "to", "it", "the", "return", "import", "from",
}


def _storePath(sourcePath):
    return sourcePath + ".keyterms.json"


def loadSticky(sourcePath):
    """LLM-seeded and hand-edited terms that persist across the session."""
    path = _storePath(sourcePath)
    if not os.path.exists(path):
        return []
    return json.load(open(path))


def saveSticky(sourcePath, terms):
    json.dump(terms, open(_storePath(sourcePath), "w"), indent=2)


def build(fileText, sticky):
    """Keyterms for one utterance: file identifiers (frequent first), then sticky terms."""
    counts = Counter()
    for word in identifierPattern.findall(fileText):
        if word not in stopWords:
            counts[word] += 1

    rankedByFrequency = []
    for word, _ in counts.most_common():
        rankedByFrequency.append(word)

    # File identifiers first, then sticky terms, deduped while keeping order.
    ordered = list(dict.fromkeys(rankedByFrequency + sticky))

    keyTerms = []
    for term in ordered:
        if len(term) <= 50:
            keyTerms.append(term)

    return keyTerms[:config.maxKeyterms]
