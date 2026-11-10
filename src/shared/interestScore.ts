// ---------------------------------------------------------------------------
// Interest scoring (key aspect 5: "track interest in an IDP").
//
// This module was built test-first (TDD): the function below started as an
// empty stub returning 0, the tests in tests/interestScore.test.ts were written
// and run first (RED), then this implementation was added to make them pass
// (GREEN). See the project report, Section 1.
//
// A shortlist is a much stronger buying signal than a view, so it is weighted
// more heavily. Score = views * VIEW_WEIGHT + shortlists * SHORTLIST_WEIGHT.
// ---------------------------------------------------------------------------

export const VIEW_WEIGHT = 1;
export const SHORTLIST_WEIGHT = 5;

/** Weighted interest score for a single portfolio. */
export function interestScore(views: number, shortlists: number): number {
  if (views < 0 || shortlists < 0) {
    throw new Error("views and shortlists must be non-negative");
  }
  return views * VIEW_WEIGHT + shortlists * SHORTLIST_WEIGHT;
}

export interface Rankable {
  id: string;
  viewCount: number;
  shortlistCount: number;
}

/** Return a new array ordered by interest score, highest first (stable on ties). */
export function rankByInterest<T extends Rankable>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => interestScore(b.viewCount, b.shortlistCount) - interestScore(a.viewCount, a.shortlistCount)
  );
}
