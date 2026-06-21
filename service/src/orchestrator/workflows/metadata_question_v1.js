import { normalizeContentTypes } from "../../config/content_types.js";
import { mergeMetadataOptions } from "../../utils/metadata.js";
import { fetchKbMetadataMatches, buildKbMetadataSection } from "../kb_metadata_match.js";
import { log } from "../../utils/log.js";

export async function runMetadataQuestion({ externalApi, kbApiClient, params, requestId, toolBudget }) {
  const askedInfo = Array.isArray(params.asked_info) ? params.asked_info : [];
  const contentTypes = normalizeContentTypes(params.filters?.content_type);

  for (const _ of contentTypes) {
    if (toolBudget.remaining() <= 0) {
      throw new Error("tool_call_budget_exceeded");
    }
    toolBudget.consume();
  }

  // Fire kb metadata lookups in parallel with cataloguesearch options (non-critical)
  const kbMatchesPromise = kbApiClient
    ? fetchKbMetadataMatches(kbApiClient, params.kb_entities, requestId).catch((err) => {
        log.warn("kb_metadata_match_failed", { requestId, error: err?.message || String(err) });
        return null;
      })
    : Promise.resolve(null);

  const optionSets = [];
  for (const ct of contentTypes) {
    const options = await externalApi.getMetadataOptions(
      { language: params.language || "hi", content_type: ct },
      requestId
    );
    const mappedResponse = Array.isArray(options)
      ? options.map((item) => ({
          g: item?.granth || "",
          au: item?.author ?? null,
          an: item?.anuyog ?? null,
          link: item?.url || "",
        }))
      : options;
    log.info("metadata_options_response", {
      requestId,
      content_type: ct,
      response: mappedResponse,
    });
    optionSets.push(options);
  }

  const kbMatches = await kbMatchesPromise;
  const kbMetadataSection = buildKbMetadataSection(kbMatches);

  const merged = mergeMetadataOptions(optionSets);
  const trimmed = merged.map((item) => {
    const entry = {};
    if (askedInfo.includes("granth")) entry.g = item.granth || "";
    if (askedInfo.includes("author")) entry.au = item.author ?? null;
    if (askedInfo.includes("anuyog")) entry.an = item.anuyog ?? null;
    if (askedInfo.includes("link")) entry.link = item.url || "";
    return entry;
  });

  return { chunks: [{ kind: "metadata", asked_info: askedInfo, options: trimmed }], kbMetadataSection };
}
