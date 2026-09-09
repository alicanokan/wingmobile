/** A solo colour/pattern must not be vetoed by the now-hidden anatomy groups. */
export function maskVisibility(colours: boolean[], patterns: boolean[], parts: boolean[]) {
  const colour = colours.some(Boolean), pattern = patterns.some(Boolean), part = parts.some(Boolean);
  return { any: colour || pattern || part, neutralColours: !colour, neutralPatterns: !pattern,
    neutralParts: !part, patternOnly: pattern && !colour && !part };
}
