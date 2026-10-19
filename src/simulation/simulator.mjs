/** Dependency-free browser/Node port of survival_env/simulator.py.
 * Rendering, policy execution and optional communication are separate concerns.
 */
export const MOVES = Object.freeze([[0, 0], [-1, 0], [0, 1], [1, 0], [0, -1]].map(Object.freeze));
export const DEFAULT_CONFIG = Object.freeze({
  size: 16, agents: 8, radius: 2, max_hunger: 20,
  initial_food: 24, food_per_step: 1, horizon: 128,
});
const LIMITS = {size: [2, 128], agents: [1, 256], radius: [0, 16],
  max_hunger: [1, 10000], initial_food: [0, 16384],
  food_per_step: [0, 16384], horizon: [1, 10000]};
const integer = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Mulberry32 + partial Fisher-Yates; deterministic, NOT NumPy PCG64.
 * Randomness is injectable through sample(candidates, count), state(), loadState().
 */
export class SeededRandom {
  constructor(seed = 0) {
    if (!integer(seed, 0, 0xffffffff)) throw new RangeError('Expected uint32 seed');
    this.value = seed;
  }
  next() {
    this.value = (this.value + 0x6d2b79f5) >>> 0;
    let t = this.value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  sample(candidates, count) {
    const pool = Array.from(candidates);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(this.next() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }
  state() { return {algorithm: 'mulberry32-v1', value: this.value}; }
  loadState(state) {
    if (state?.algorithm !== 'mulberry32-v1' || !integer(state.value, 0, 0xffffffff)) {
      throw new RangeError('Invalid random state');
    }
    this.value = state.value;
  }
}

export class SurvivalWorld {
  constructor({config = {}, seed = 0, random = new SeededRandom(seed)} = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        Object.keys(config).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown configuration');
    const c = {...DEFAULT_CONFIG, ...config};
    if (Object.entries(LIMITS).some(([k, [lo, hi]]) => !integer(c[k], lo, hi)) ||
        c.agents > c.size ** 2) throw new RangeError('Unsupported bounded world configuration');
    if (typeof random?.sample !== 'function') throw new TypeError('Expected random sampling source');
    this.config = Object.freeze(c);
    this.random = random;
    const cells = this._sample(Array.from({length: c.size ** 2}, (_, i) => i), c.agents);
    this.positions = cells.map(i => [Math.floor(i / c.size), i % c.size]);
    this.alive = Array(c.agents).fill(true);
    this.hunger = Array(c.agents).fill(c.max_hunger);
    this.food = new Uint8Array(c.size ** 2);
    this.tick = 0;
    this._spawn(c.initial_food);
  }
  get done() { return this.tick >= this.config.horizon || !this.alive.some(Boolean); }
  _cell([y, x]) { return y * this.config.size + x; }
  _sample(candidates, count) {
    const chosen = Array.from(this.random.sample(candidates.slice(), count));
    const allowed = new Set(candidates);
    if (chosen.length !== count || new Set(chosen).size !== count || chosen.some(v => !allowed.has(v))) {
      throw new RangeError('Random source must sample valid cells without replacement');
    }
    return chosen;
  }
  _spawn(count) {
    if (!count) return;
    const occupied = new Set(this.positions.filter((_, i) => this.alive[i]).map(p => this._cell(p)));
    const candidates = [];
    for (let cell = 0; cell < this.food.length; cell++) {
      if (!this.food[cell] && !occupied.has(cell)) candidates.push(cell);
    }
    if (candidates.length) {
      for (const cell of this._sample(candidates, Math.min(count, candidates.length))) this.food[cell] = 1;
    }
  }
  /** One independent Float32Array per agent, flattened [channel, row, column]. */
  observe() {
    const c = this.config, width = 2 * c.radius + 1, plane = width ** 2;
    const occupied = new Set(this.positions.filter((_, i) => this.alive[i]).map(p => this._cell(p)));
    return this.positions.map(([y, x], i) => {
      const obs = new Float32Array(5 * plane);
      if (!this.alive[i]) return obs;
      for (let oy = 0; oy < width; oy++) for (let ox = 0; ox < width; ox++) {
        const qy = y + oy - c.radius, qx = x + ox - c.radius;
        if (qy >= 0 && qy < c.size && qx >= 0 && qx < c.size) {
          const cell = qy * c.size + qx, index = oy * width + ox;
          obs[index] = this.food[cell];
          obs[2 * plane + index] = Number(occupied.has(cell) && (qy !== y || qx !== x));
          obs[3 * plane + index] = 1;
        }
      }
      obs[plane + c.radius * width + c.radius] = 1;
      obs.fill(this.hunger[i] / c.max_hunger, 4 * plane);
      return obs;
    });
  }
  step(actions) {
    if (this.done) throw new Error('Episode is finished');
    const c = this.config;
    if ((!Array.isArray(actions) && !ArrayBuffer.isView(actions)) || actions.length !== c.agents ||
        !Array.from(actions).every(a => integer(a, 0, 4))) {
      throw new RangeError('One integer move/wait action (0..4) per agent required');
    }
    const old = this.positions.map(p => p.slice());
    const occupied = new Set(old.filter((_, i) => this.alive[i]).map(p => this._cell(p)));
    const candidates = new Map();
    for (let i = 0; i < c.agents; i++) if (this.alive[i] && actions[i]) {
      const [dy, dx] = MOVES[actions[i]], q = [old[i][0] + dy, old[i][1] + dx];
      if (q.every(v => v >= 0 && v < c.size) && !occupied.has(this._cell(q))) {
        const cell = this._cell(q);
        if (!candidates.has(cell)) candidates.set(cell, []);
        candidates.get(cell).push([i, q]);
      }
    }
    for (const ids of candidates.values()) if (ids.length === 1) this.positions[ids[0][0]] = ids[0][1];
    const ate = Array(c.agents).fill(false), died = Array(c.agents).fill(false);
    for (let i = 0; i < c.agents; i++) if (this.alive[i]) {
      this.hunger[i]--;
      const cell = this._cell(this.positions[i]);
      if (this.food[cell]) {
        this.food[cell] = 0;
        this.hunger[i] = c.max_hunger;
        ate[i] = true;
      }
      if (this.hunger[i] <= 0) { died[i] = true; this.alive[i] = false; }
    }
    this.tick++;
    this._spawn(c.food_per_step);
    return {observations: this.observe(), rewards: Float32Array.from(this.alive, Number),
      done: this.done, info: {ate, died, truncated: this.tick >= c.horizon}};
  }
  /** Full-world frame is for renderer/inspection; never pass it to a policy. */
  frame() {
    const food = [];
    for (let i = 0; i < this.food.length; i++) if (this.food[i]) {
      food.push([Math.floor(i / this.config.size), i % this.config.size]);
    }
    return {tick: this.tick, positions: this.positions.map(p => p.slice()),
      alive: this.alive.slice(), hunger: this.hunger.slice(), food};
  }
  state() {
    if (typeof this.random.state !== 'function') throw new Error('Random source cannot checkpoint');
    return {format: 1, config: {...this.config}, ...this.frame(), random_state: structuredClone(this.random.state())};
  }
  loadState(state) {
    const c = this.config, coord = p => Array.isArray(p) && p.length === 2 && p.every(v => integer(v, 0, c.size - 1));
    if (state?.format !== 1 || Object.keys(DEFAULT_CONFIG).some(k => state.config?.[k] !== c[k]) ||
        !integer(state.tick, 0, c.horizon) ||
        !Array.isArray(state.positions) || state.positions.length !== c.agents || !state.positions.every(coord) ||
        !Array.isArray(state.alive) || state.alive.length !== c.agents || !state.alive.every(v => typeof v === 'boolean') ||
        !Array.isArray(state.hunger) || state.hunger.length !== c.agents ||
        !state.hunger.every((v, i) => integer(v, 0, c.max_hunger) && (state.alive[i] ? v > 0 : v === 0)) ||
        !Array.isArray(state.food) || !state.food.every(coord)) throw new RangeError('Invalid world state');
    const liveCells = state.positions.filter((_, i) => state.alive[i]).map(p => this._cell(p));
    if (new Set(liveCells).size !== liveCells.length ||
        new Set(state.food.map(p => this._cell(p))).size !== state.food.length) throw new RangeError('Duplicate cells');
    if (typeof this.random.loadState !== 'function') throw new Error('Random source cannot restore');
    this.random.loadState(structuredClone(state.random_state));
    this.positions = state.positions.map(p => p.slice());
    this.alive = state.alive.slice();
    this.hunger = state.hunger.slice();
    this.food = new Uint8Array(c.size ** 2);
    for (const p of state.food) this.food[this._cell(p)] = 1;
    this.tick = state.tick;
  }
}
