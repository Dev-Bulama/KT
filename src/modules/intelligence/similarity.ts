/**
 * Deterministic text similarity for duplicate and shared-solution detection.
 * A similarity score is an INDICATOR for human review, never proof of duplication.
 */
const STOP = new Set("a an and are as at be by for from has have in into is it its of on or our that the their this to was we will with system systems request ministry agency department katsina state need needs new".split(" "));

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
      .map((t) => t.replace(/(ing|ed|es|s)$/, "")),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Doc {
  id: string;
  text: string;
  group?: string;
}

/** Returns pairs above the threshold, most similar first. */
export function similarPairs(docs: Doc[], threshold = 0.3) {
  const toks = docs.map((d) => tokens(d.text));
  const pairs: { a: string; b: string; score: number; shared: string[] }[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const s = jaccard(toks[i], toks[j]);
      if (s >= threshold) pairs.push({ a: docs[i].id, b: docs[j].id, score: Math.round(s * 100) / 100, shared: [...toks[i]].filter((t) => toks[j].has(t)).slice(0, 10) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/** Groups documents into clusters of mutually similar items (single-linkage), keeping clusters spanning ≥ minGroups distinct groups (e.g. MDAs). */
export function clusters(docs: Doc[], threshold = 0.3, minGroups = 2) {
  const parent = new Map(docs.map((d) => [d.id, d.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const pairs = similarPairs(docs, threshold);
  for (const p of pairs) parent.set(find(p.a), find(p.b));
  const groups = new Map<string, Doc[]>();
  for (const d of docs) {
    const r = find(d.id);
    groups.set(r, [...(groups.get(r) ?? []), d]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1 && new Set(g.map((d) => d.group)).size >= minGroups)
    .map((g) => {
      const common = [...g.map((d) => tokens(d.text)).reduce((acc, t) => new Set([...acc].filter((x) => t.has(x))))];
      return { docs: g, commonTerms: common.slice(0, 10) };
    });
}
