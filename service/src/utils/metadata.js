export function mergeMetadataOptions(optionSets) {
  const merged = [];
  for (const options of optionSets || []) {
    if (!Array.isArray(options)) continue;
    merged.push(...options);
  }
  return dedupeTuples(merged);
}

function dedupeTuples(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = JSON.stringify({
      granth: item.granth || "",
      author: item.author || "",
      anuyog: item.anuyog || "",
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      granth: item.granth || "",
      author: item.author ?? null,
      anuyog: item.anuyog ?? null,
      url: item.url || "",
    });
  }
  return result;
}
