// ---------------------------------------------------------------------------
// Curated pool of real interior-design photos (free-to-use Unsplash CDN URLs).
// Listings link to these so the platform looks like a genuine ID marketplace.
// Grouped loosely by look so a listing can be given photos that match its style.
// All URLs are permanent image CDN links (images.unsplash.com), hotlinkable.
// ---------------------------------------------------------------------------

const W = "?w=900&q=80&auto=format&fit=crop";

// Each entry is a real interior photograph.
export const INTERIOR_PHOTOS: Record<string, string[]> = {
  living: [
    "https://images.unsplash.com/photo-1586023492125-27b2c045efd7" + W,
    "https://images.unsplash.com/photo-1600210492493-0946911123ea" + W,
    "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6" + W,
    "https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e" + W,
    "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92" + W,
  ],
  kitchen: [
    "https://images.unsplash.com/photo-1600489000022-c2086d79f9d4" + W,
    "https://images.unsplash.com/photo-1556911220-bff31c812dba" + W,
    "https://images.unsplash.com/photo-1556912172-45b7abe8b7e1" + W,
    "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea" + W,
  ],
  bedroom: [
    "https://images.unsplash.com/photo-1616594039964-ae9021a400a0" + W,
    "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af" + W,
    "https://images.unsplash.com/photo-1540518614846-7eded433c457" + W,
    "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85" + W,
  ],
  dining: [
    "https://images.unsplash.com/photo-1617806118233-18e1de247200" + W,
    "https://images.unsplash.com/photo-1615874959474-d609969a20ed" + W,
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c" + W,
  ],
  bathroom: [
    "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3" + W,
    "https://images.unsplash.com/photo-1620626011761-996317b8d101" + W,
    "https://images.unsplash.com/photo-1507652313519-d4e9174996dd" + W,
  ],
  overall: [
    "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0" + W,
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c" + W,
    "https://images.unsplash.com/photo-1600121848594-d8644e57abab" + W,
    "https://images.unsplash.com/photo-1598928506311-c55ded91a20c" + W,
  ],
};

// A flat, de-duplicated list in a sensible gallery order (overall shot first).
export const PHOTO_SEQUENCE: string[] = [
  ...INTERIOR_PHOTOS.overall,
  ...INTERIOR_PHOTOS.living,
  ...INTERIOR_PHOTOS.kitchen,
  ...INTERIOR_PHOTOS.dining,
  ...INTERIOR_PHOTOS.bedroom,
  ...INTERIOR_PHOTOS.bathroom,
];

/** Deterministically pick `n` photos for a listing, seeded by an index so the
 *  same listing always shows the same gallery. Returns an overall/hero shot
 *  first, then a spread of room photos. */
export function photosForListing(seedIndex: number, n: number): string[] {
  const out: string[] = [];
  const hero = INTERIOR_PHOTOS.overall[seedIndex % INTERIOR_PHOTOS.overall.length];
  out.push(hero);
  const rooms = [...INTERIOR_PHOTOS.living, ...INTERIOR_PHOTOS.kitchen, ...INTERIOR_PHOTOS.bedroom, ...INTERIOR_PHOTOS.dining, ...INTERIOR_PHOTOS.bathroom];
  for (let i = 1; i < n; i++) {
    out.push(rooms[(seedIndex * 3 + i) % rooms.length]);
  }
  return out;
}

/** True if a stored photo "url" is an actual image (http(s) link or uploaded data URL). */
export function isImageUrl(url: string): boolean {
  return /^https?:\/\//.test(url) || /^data:image\//.test(url);
}
