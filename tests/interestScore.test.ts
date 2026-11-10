// Unit tests for the interest-scoring feature, written BEFORE the
// implementation as part of the test-driven development cycle (report Sec. 1).
// Each case is its own test function, as in the TDD exercise brief.
import { test } from "node:test";
import assert from "node:assert/strict";
import { interestScore, rankByInterest, VIEW_WEIGHT, SHORTLIST_WEIGHT } from "../src/shared/interestScore.js";

test("score of zero activity is zero", () => {
  assert.equal(interestScore(0, 0), 0);
});

test("views only are counted at the view weight", () => {
  assert.equal(interestScore(10, 0), 10 * VIEW_WEIGHT);
});

test("shortlists only are counted at the (heavier) shortlist weight", () => {
  assert.equal(interestScore(0, 3), 3 * SHORTLIST_WEIGHT);
});

test("views and shortlists combine additively", () => {
  assert.equal(interestScore(10, 2), 10 * VIEW_WEIGHT + 2 * SHORTLIST_WEIGHT);
});

test("a shortlist outweighs a single view", () => {
  assert.ok(interestScore(0, 1) > interestScore(1, 0));
});

test("negative inputs are rejected", () => {
  assert.throws(() => interestScore(-1, 0));
  assert.throws(() => interestScore(0, -2));
});

test("rankByInterest orders portfolios highest score first", () => {
  const items = [
    { id: "a", viewCount: 100, shortlistCount: 0 }, // score 100
    { id: "b", viewCount: 10, shortlistCount: 20 }, // score 110
    { id: "c", viewCount: 5, shortlistCount: 1 }, // score 10
  ];
  const ranked = rankByInterest(items).map((i) => i.id);
  assert.deepEqual(ranked, ["b", "a", "c"]);
});

test("rankByInterest does not mutate the input array", () => {
  const items = [
    { id: "x", viewCount: 1, shortlistCount: 0 },
    { id: "y", viewCount: 0, shortlistCount: 9 },
  ];
  const copy = [...items];
  rankByInterest(items);
  assert.deepEqual(items, copy);
});
