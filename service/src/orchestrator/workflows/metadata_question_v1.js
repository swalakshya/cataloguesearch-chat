import { mergeMetadataOptions, normalizeContentTypes } from "./metadata_utils.js";
import { log } from "../../utils/log.js";

export async function runMetadataQuestion({ externalApi, params, requestId, toolBudget }) {
  const askedInfo = Array.isArray(params.asked_info) ? params.asked_info : [];
  const normalizedTypes = normalizeContentTypes(params.filters?.content_type);
  const contentTypes = normalizedTypes.length ? normalizedTypes : ["Granth", "Books"];
  if (!contentTypes.includes("Granth")) contentTypes.push("Granth");
  if (!contentTypes.includes("Books")) contentTypes.push("Books");

  for (const _ of contentTypes) {
    if (toolBudget.remaining() <= 0) {
      throw new Error("tool_call_budget_exceeded");
    }
    toolBudget.consume();
  }

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

  const merged = mergeMetadataOptions(optionSets);
  const trimmed = merged.map((item) => {
    const entry = {};
    if (askedInfo.includes("granth")) entry.g = item.granth || "";
    if (askedInfo.includes("author")) entry.au = item.author ?? null;
    if (askedInfo.includes("anuyog")) entry.an = item.anuyog ?? null;
    if (askedInfo.includes("link")) entry.link = item.url || "";
    return entry;
  });

  return [{ kind: "metadata", asked_info: askedInfo, options: trimmed }];
}
