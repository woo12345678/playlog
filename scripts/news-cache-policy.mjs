export function chooseSourceItems(previousItems, parsedItems) {
  const previous = Array.isArray(previousItems) ? previousItems : [];
  const parsed = Array.isArray(parsedItems) ? parsedItems : [];
  return parsed.length
    ? { items:parsed, ok:true, reason:'' }
    : { items:previous, ok:false, reason:'empty-parse' };
}

export function cacheRunMetadata(previous, runAt, fullRefresh) {
  return {
    generatedAt: fullRefresh ? runAt : (previous?.generatedAt || runAt),
    updatedAt: runAt
  };
}
