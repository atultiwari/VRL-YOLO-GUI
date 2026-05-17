/**
 * Stable per-class colour mapping for predict-page visuals.
 *
 * Indexing by class id (instead of, say, a deterministic hash of class
 * name) means a class keeps its colour across runs *and* across runs
 * with different model checkpoints that happen to share the class id —
 * which is what a doctor squinting at "did this nucleus move?"
 * implicitly relies on.
 */
export const PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899",
  "#14b8a6", "#f97316", "#0ea5e9", "#84cc16", "#f43f5e", "#a855f7",
  "#6366f1", "#22c55e", "#eab308", "#06b6d4", "#d946ef", "#84cc16",
];

export function colourFor(classId: number): string {
  return PALETTE[classId % PALETTE.length];
}
