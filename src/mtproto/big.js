// A hand-kept MODEL of the big strings this library holds at once (hex of packets and chunks), so a test can bound the
// peak under QuickJS's 64 MiB per-plugin cap. It is NOT the real QuickJS heap: it only knows what the code tells it
// (hold when a big string is made or taken, release at its last use), so it catches a release missing in our code, or a
// copy kept longer than planned, never a reference kept by mistake that nobody declared, and never the copies made
// inside kino.crypto/kino.ws (the prelude's JSON, Kotlin). Strings handed to a caller (getFile's answer) are the
// caller's: not counted here. Counts characters of strings of at least BIG characters (hex: 2 per byte).
const BIG = 65536;
export const big = {
  live: 0,
  peak: 0,
  /** Counts a string of `n` characters (when it is big); answers what it counted, for a symmetric release. */
  hold(n) { if (n >= BIG) { this.live += n; if (this.live > this.peak) this.peak = this.live; return n; } return 0; },
  /** The opposite of hold(n). No clamp: a release with no matching hold shows as a negative live count. */
  release(n) { if (n >= BIG) this.live -= n; },
  /** Takes back exactly what hold() answered (a sum of holds of different sizes). */
  releaseCounted(counted) { this.live -= counted; },
  reset() { this.live = 0; this.peak = 0; },
};
