// Client message ids: about unixtime * 2^32, divisible by 4, strictly increasing within a session.
export class MsgIds {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.last = 0n;
  }
  /** `offsetSec`: server time minus local time. */
  next(offsetSec = 0) {
    const ms = this.now();
    const secs = BigInt(Math.floor(ms / 1000) + offsetSec);
    const frac = BigInt(Math.floor((ms % 1000) * 4294967.296)) & ~3n;
    let id = (secs << 32n) | frac;
    if (id <= this.last) id = this.last + 4n;
    this.last = id;
    return id;
  }
}
