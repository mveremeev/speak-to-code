import { maxKeyterms } from "./config.js";

const identifierPattern = /[A-Za-z_][A-Za-z0-9_]{0,49}/g;

// Words too generic to waste a keyterm slot on.
const stopWords = new Set([
  "self", "True", "False", "None", "and", "for", "in", "if", "is",
  "as", "of", "to", "it", "the", "return", "import", "from",
]);

export function build(fileText, sticky = []) {
  // Count identifiers in the file, ignoring the generic ones.
  const counts = new Map();
  for (const word of fileText.match(identifierPattern) || []) {
    if (stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  // Most frequent first (stable sort keeps first-seen order on ties).
  const rankedByFrequency = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  // File identifiers first, then sticky terms, deduped while keeping order.
  const ordered = [...new Set([...rankedByFrequency, ...sticky])];

  const keyTerms = ordered.filter((term) => term.length <= 50);
  return keyTerms.slice(0, maxKeyterms);
}
