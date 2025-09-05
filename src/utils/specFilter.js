// Spec-looking tokens: numbers + units
// expand if needed (kPa, gph, L/h, rpm, Ah, Wh, kWh, MPa, etc.)
export const SPEC_RX = /\b(\d+(\.\d+)?)\s?(psi|bar|v|a|kw|w|hz|°c|°f|nm|mm|cm|l\/min)\b/i;

export function filterSpecLike(chunks) {
  return chunks.filter(h => {
    const text =
      h?.chunk?.content ??
      h?.metadata?.content ??
      h?.content ??
      "";
    return SPEC_RX.test(text);
  });
}
