// Parkhaven - seeded deterministic PRNG (sfc32). All simulation randomness goes through this.
export class Rng {
  constructor(seed = 1) {
    // splitmix32 to spread the seed over the whole state
    let x = seed >>> 0;
    const sm = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s = [sm(), sm(), sm(), sm()];
    for (let i = 0; i < 16; i++) this.next();
  }
  next() {
    let [a, b, c, d] = this.s;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    this.s[0] = a >>> 0; this.s[1] = b; this.s[2] = c; this.s[3] = d;
    return t;
  }
  /** integer in [0, n) */
  rand(n) { return Math.floor((this.next() / 4294967296) * n); }
  /** true with probability p/of */
  chance(p, of) { return this.rand(of) < p; }
  float() { return this.next() / 4294967296; }
  pick(arr) { return arr[this.rand(arr.length)]; }
  save() { return this.s.slice(); }
  load(s) { this.s = s.slice(); }
}
