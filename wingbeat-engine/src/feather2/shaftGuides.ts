/** Photographic centreline landmarks, measured on the library originals.
 * Coordinates use each photograph scaled to 960px high; stored normalized.
 * Never apply a library guide to a user upload with a similar filename. */
const guides: Record<string, { width: number; points: number[][] }> = {
  '01f': { width: 218, points: [[79,941],[81,900],[85,820],[88,730],[91,640],[95,560],[101,460],[109,350],[117,260],[125,180],[132,123]] },
  '05f': { width: 225, points: [[120,925],[121,860],[120,790],[118,700],[114,610],[109,520],[106,430],[104,340],[105,250],[108,150],[110,64]] },
  '10f': { width: 179, points: [[116,947],[115,850],[113,750],[112,650],[109,550],[105,450],[101,350],[98,250],[101,150],[106,74]] },
};
export function libraryShaftGuide(source: string): number[][] | undefined {
  const match = /^\/feathers\/(01f|05f|10f)\.png$/.exec(source);
  const guide = match && guides[match[1]];
  return guide ? guide.points.map(([x, y]) => [x / guide.width, y / 960]) : undefined;
}
