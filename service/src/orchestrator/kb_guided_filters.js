import { log } from "../utils/log.js";
import { SHASTRA_CANONICAL_TRANSLATED_NAMING } from "../config/shastra_canonical_translated_naming.js";

// Maps a Hindi verse-identifier token (from `gatha_identifier` in
// shastra_canonical_translated_naming.js) to the corresponding agent-search
// verse filter field (a `chunk_labels.*` keyword field on the backend).
const VERSE_IDENTIFIER_TO_FIELD = {
  "गाथा": "gatha",
  "श्लोक": "shlok",
  "दोहक": "doha",
  "दोहा": "doha",
  "काव्य": "kavya",
  "सूत्र": "sutra",
};

/**
 * Derive the agent-search verse filter field for a canonical-naming entry.
 *
 * Per the guided-filter contract, a verse-level filter (gatha/shlok/doha/
 * kavya/sutra) is only applied when the shastra is NOT split by adhikaar
 * (`includes_adhikaar !== true`) — for adhikaar-scoped shastras a bare verse
 * number is ambiguous across chapters. The concrete field is read from the
 * entry's single-component `gatha_identifier`; when no `gatha_identifier` is
 * present (and the shastra is not adhikaar-scoped) the field defaults to
 * `gatha`. Returns null when no usable verse field can be derived
 * (adhikaar-scoped, multi-component identifier, or an unmapped token such as
 * प्रश्न).
 */
function verseFieldForEntry(entry) {
  if (entry.includes_adhikaar === true) return null;
  const identifier = entry.gatha_identifier;
  if (!identifier) return "gatha";
  if (identifier.includes(",")) return null;
  return VERSE_IDENTIFIER_TO_FIELD[identifier.trim()] ?? null;
}

// Map a Hindi shastra natural_key → all matching cataloguesearch entries
// (english_name + derived verse filter field). One Hindi name can map to
// multiple english_names (e.g. समयसार → "Samaysaar" and "Samaysaar Kalash
// Tika"), so each is queried with its own agent API call.
const HINDI_TO_GRANTH_FILTERS = (() => {
  const m = new Map();
  for (const entry of SHASTRA_CANONICAL_TRANSLATED_NAMING) {
    if (!entry.hindi_name) continue;
    if (!m.has(entry.hindi_name)) m.set(entry.hindi_name, []);
    m.get(entry.hindi_name).push({
      granth: entry.english_name,
      verseField: verseFieldForEntry(entry),
    });
  }
  return m;
})();

/**
 * Resolve a guided-filter shastra (a Hindi natural_key) to the cataloguesearch
 * `granth` english_name(s). Returns all matches; falls back to the raw value
 * when no mapping exists so callers still issue at least one query.
 */
export function resolveGranthNames(shastra) {
  if (!shastra) return [];
  return (HINDI_TO_GRANTH_FILTERS.get(shastra) ?? []).map((f) => f.granth);
}

/**
 * Resolve a guided-filter shastra (a Hindi natural_key) to the cataloguesearch
 * `granth` english_name(s) plus the verse filter field applicable to each
 * (`gatha`/`shlok`/`doha`/`kavya`/`sutra`, or null). Returns
 * `[{ granth, verseField }]`.
 */
export function resolveGranthFilters(shastra) {
  if (!shastra) return [];
  return HINDI_TO_GRANTH_FILTERS.get(shastra) ?? [];
}

// Publication-locator field that is NOT a verse identifier (mirrors the
// EXCLUDED_REF_FIELDS noise filtered out in kb_topic_match's formatMainRef).
const PAGE_IDENTIFIER = "पृष्ठ";

// Every Hindi verse token we know how to map to an agent-search field.
const VERSE_IDENTIFIERS = new Set(Object.keys(VERSE_IDENTIFIER_TO_FIELD));

// Hindi shastra name → the verse token to look for in a reference, taken from
// the canonical naming's `gatha_identifier` (the LAST component for compound
// identifiers like "अधिकार,श्लोक", and "गाथा" when unspecified). This is the
// single source of truth for "which field is the verse" per shastra — the verse
// is NOT always गाथा (it can be श्लोक/दोहक/सूत्र/काव्य).
const HINDI_TO_VERSE_TOKEN = (() => {
  const m = new Map();
  for (const entry of SHASTRA_CANONICAL_TRANSLATED_NAMING) {
    if (!entry.hindi_name || m.has(entry.hindi_name)) continue;
    const id = entry.gatha_identifier;
    const token = id ? id.split(",").pop().trim() : "गाथा";
    m.set(entry.hindi_name, token);
  }
  return m;
})();

// Strip a leading shastra/teeka name from a resolved-field name so prefixed
// identifiers match (e.g. "तत्त्वार्थसूत्रसूत्र" → "सूत्र", "परमात्मप्रकाशगाथा"
// → "गाथा"). Mirrors kb_topic_match's stripSourcePrefix.
function stripSourcePrefix(field, ...prefixes) {
  for (const p of prefixes) {
    if (p && field.startsWith(p) && field.length > p.length) return field.slice(p.length);
  }
  return field;
}

/**
 * Normalize a single extract's `main_reference` into the flat guided-filter
 * shape `{ shastra, gatha, page, teeka }`.
 *
 * The live `topics_match` response carries verse granularity ONLY here (not in
 * the coarse topic-level `references[]`, where `gatha_number` is null). The
 * verse number lives in `resolved_fields` keyed by a Hindi verse identifier
 * which is shastra-specific (गाथा/श्लोक/दोहक/सूत्र/काव्य) and may be
 * shastra-prefixed. The expected token comes from the canonical naming config;
 * when the shastra is unknown there we fall back to matching any known verse
 * token. `shastra_name` is the Hindi natural_key consumed by HINDI_TO_GRANTH_FILTERS.
 */
function refFromMainReference(mainReference) {
  if (!mainReference) return null;
  const shastra = mainReference.shastra_name ?? null;
  if (!shastra) return null;
  const teeka = mainReference.teeka_name ?? null;
  const token = HINDI_TO_VERSE_TOKEN.get(shastra) ?? null;
  let gatha = null;
  let page = null;
  for (const fld of (mainReference.resolved_fields || [])) {
    if (!fld || fld.field == null || fld.value == null) continue;
    const name = stripSourcePrefix(String(fld.field).trim(), shastra, teeka);
    if (page == null && name === PAGE_IDENTIFIER) {
      page = fld.value;
    } else if (gatha == null && isVerseField(name, token)) {
      gatha = fld.value;
    }
  }
  return { shastra, gatha, page, teeka };
}

// A resolved field is the verse when it matches the shastra's expected token
// (exact or as a suffix, to absorb residual prefixes) — or, when the shastra is
// not in the canonical config, when it is any known verse identifier.
function isVerseField(name, token) {
  if (token) return name === token || name.endsWith(token);
  return VERSE_IDENTIFIERS.has(name);
}

/**
 * Collect all candidate guided-filter refs for one merged topic, from both the
 * per-extract `main_reference` (verse-level) and the coarse topic-level
 * `references[]` (granth-level fallback). A topic-level granth-only ref is
 * dropped when a verse-bearing ref already exists for the same shastra, so we
 * don't fire a redundant granth-only search alongside the precise verse one.
 */
function refsForTopic(t) {
  const refs = [];
  for (const ex of (t.extracts_hi ?? [])) {
    const r = refFromMainReference(ex?.main_reference);
    if (r) refs.push(r);
  }
  for (const ref of (t.references ?? [])) {
    refs.push({
      shastra: ref.shastra_natural_key ?? null,
      gatha: ref.gatha_number ?? null,
      page: ref.page_number ?? null,
      teeka: ref.teeka_natural_key ?? null,
    });
  }
  const shastrasWithGatha = new Set(refs.filter((r) => r.gatha != null).map((r) => r.shastra));
  return refs.filter((r) => r.gatha != null || !shastrasWithGatha.has(r.shastra));
}

/**
 * Derive guided filters from merged KB topics.
 * Pure function — no I/O. Cap defaults to KB_GUIDED_FILTERS_CAP env var (default 5).
 */
export function deriveGuidedFilters(mergedTopics, cap) {
  const effectiveCap = cap != null ? cap : Number(process.env.KB_GUIDED_FILTERS_CAP || 5);
  if (effectiveCap <= 0) return [];
  const seen = new Set();
  const out = [];
  for (const t of (mergedTopics || [])) {
    for (const f of refsForTopic(t)) {
      if (Object.values(f).every((v) => v == null)) continue;
      const key = JSON.stringify(f);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
      if (out.length >= effectiveCap) return out;
    }
  }
  return out;
}

/**
 * Run one filtered search per guided filter and collect labelled buckets.
 *
 * The agent API is NOT modified for guided search: instead of asking the API
 * to run guided retrievals server-side, chat fires a separate `search` call
 * per guided filter and assembles the `guided_results[]` buckets itself.
 *
 * shastra (a natural_key) maps to the agent-search `granth` field. When the
 * resolved shastra is not adhikaar-scoped, the guided filter's `gatha` number
 * is ALSO passed as the agent-search verse filter matching the shastra's
 * `gatha_identifier` (gatha/shlok/doha/kavya/sutra) for a tighter retrieval.
 * page/teeka (and gatha for adhikaar-scoped shastras) have no corresponding
 * agent-search field, so they are carried only in the returned label (the LLM
 * still sees them in the Step2 "Guided Passages" section).
 *
 * Returns `[{ guided_filter, results }]`. Best-effort: per-call failures are
 * logged and skipped; an empty/missing filter list returns `[]`.
 */
export async function fetchGuidedResults({
  externalApi,
  guidedFilters,
  baseFilters,
  query,
  language,
  requestId,
  toolBudget,
  pageSize,
}) {
  const filters = Array.isArray(guidedFilters) ? guidedFilters : [];
  if (!filters.length || !query) return [];
  const size = pageSize != null ? pageSize : Number(process.env.KB_GUIDED_PAGE_SIZE || 3);
  const out = [];
  for (const f of filters) {
    // A shastra (Hindi natural_key) can map to multiple cataloguesearch
    // english_names; fire one search per matching granth english_name.
    // Skip entirely if no english_name mapping exists.
    const granthFilters = f && f.shastra ? resolveGranthFilters(f.shastra) : [];
    if (!granthFilters.length) {
      log.warn("guided_search_skipped_no_mapping", { requestId, shastra: f?.shastra });
      continue;
    }
    log.verbose("guided_search_filter", { requestId, shastra: f.shastra, gatha: f.gatha, granthFilters });
    for (const { granth, verseField } of granthFilters) {
      if (toolBudget && toolBudget.remaining() <= 0) return out;
      // Apply the verse filter (gatha/shlok/doha/kavya/sutra) only for
      // non-adhikaar shastras that expose a usable gatha_identifier.
      const verseFilter =
        verseField && f.gatha != null ? { [verseField]: String(f.gatha) } : {};
      const payload = {
        ...(baseFilters || {}),
        query,
        language: language || "hi",
        page_size: size,
        page: 1,
        ...(granth ? { granth } : {}),
        ...verseFilter,
      };
      toolBudget?.consume();
      try {
        const results = await externalApi.search(payload, requestId);
        out.push({
          guided_filter: f,
          granth: granth || null,
          verse_filter: verseFilter,
          results: Array.isArray(results) ? results : [],
        });
      } catch (err) {
        log.warn("guided_search_failed", {
          requestId,
          guided_filter: f,
          granth,
          error: err?.message || String(err),
        });
      }
    }
  }
  return out;
}
