/** synthetic-survival-v2.0: versioned browser extension; legacy rules unchanged. */
import {SurvivalWorld, SeededRandom} from './simulator.mjs';

export const SYNTHETIC_VERSION = 'synthetic-survival-v2.0';
export const SYNTHETIC_DEFAULTS = Object.freeze({size: 16, agents: 8, radius: 2,
  power_limit: 24, initial_resources: 32, resources_per_step: 2, horizon: 128,
  wear_limit: 96, max_integrity: 5, hazard_count: 24, hazard_damage: 1, hazard_period: 12});
const bounded = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export class SyntheticWorld {
  constructor({seed = 0, config = {}} = {}) {
    if (!config || typeof config !== 'object' || Object.keys(config).some(k => !Object.hasOwn(SYNTHETIC_DEFAULTS, k))) throw new RangeError('Unknown synthetic configuration');
    const c = {...SYNTHETIC_DEFAULTS, ...config};
    if (!bounded(seed, 0, 0xffffffff) || !bounded(c.wear_limit, 2, 10000) ||
        !bounded(c.max_integrity, 1, 1000) || !bounded(c.hazard_count, 0, 16384) ||
        !bounded(c.hazard_damage, 1, 1000) || !bounded(c.hazard_period, 2, 128)) throw new RangeError('Invalid synthetic bounds');
    this.base = new SurvivalWorld({seed, config: {size: c.size, agents: c.agents, radius: c.radius,
      max_hunger: c.power_limit, initial_food: c.initial_resources, food_per_step: c.resources_per_step, horizon: c.horizon}});
    this.config = Object.freeze(c);
    this.seed = seed;
    this.wear = Array(c.agents).fill(0);
    this.integrity = Array(c.agents).fill(c.max_integrity);
    this.failureCauses = Array.from({length: c.agents}, () => []);
    const random = new SeededRandom((seed ^ 0xa5612c3d) >>> 0);
    this.hazardCells = random.sample(Array.from({length: c.size ** 2}, (_, i) => i), Math.min(c.hazard_count, c.size ** 2));
  }
  get done() { return this.base.done; }
  get tick() { return this.base.tick; }
  get hazardsActive() { return this.tick % this.config.hazard_period < Math.ceil(this.config.hazard_period / 2); }
  observe() {
    const c = this.config, width = 2*c.radius+1, plane = width**2;
    const hazards = new Set(this.hazardCells);
    return this.base.observe().map((base, i) => {
      const obs = new Float32Array(8*plane);
      if (!this.base.alive[i]) return obs;
      obs.set(base);
      const [y, x] = this.base.positions[i];
      for (let oy = 0; oy < width; oy++) for (let ox = 0; ox < width; ox++) {
        const qy = y+oy-c.radius, qx = x+ox-c.radius;
        if (qy >= 0 && qy < c.size && qx >= 0 && qx < c.size && this.hazardsActive && hazards.has(qy*c.size+qx)) obs[5*plane+oy*width+ox] = 1;
      }
      obs.fill(this.wear[i]/c.wear_limit, 6*plane, 7*plane);
      obs.fill(this.integrity[i]/c.max_integrity, 7*plane);
      return obs;
    });
  }
  step(actions) {
    const before = this.base.alive.slice();
    // Base validates before mutation; its depletion/replenishment semantics are retained.
    const result = this.base.step(actions);
    const c = this.config, hazards = new Set(this.hazardCells);
    const died = result.info.died.slice();
    for (let i = 0; i < c.agents; i++) if (before[i]) {
      this.wear[i]++;
      const [y, x] = this.base.positions[i];
      if (this.hazardsActive && hazards.has(y*c.size+x)) this.integrity[i] = Math.max(0, this.integrity[i]-c.hazard_damage);
      const causes = [];
      if (result.info.died[i]) causes.push('power depletion');
      if (this.integrity[i] === 0) causes.push('integrity failure');
      if (this.wear[i] >= c.wear_limit) causes.push('lifetime wear');
      if (causes.length) {
        this.base.alive[i] = false; this.base.hunger[i] = 0;
        this.failureCauses[i] = causes; died[i] = true;
      }
    }
    return {observations: this.observe(), rewards: Float32Array.from(this.base.alive, Number), done: this.done,
      info: {ate: result.info.ate, died, terminated: died.slice(), truncated: this.tick >= c.horizon,
             continuation: this.base.alive.map(Number), failureCauses: this.failureCauses.map(v => v.slice())}};
  }
  frame() {
    const base = this.base.frame(), size = this.config.size;
    return {version: SYNTHETIC_VERSION, tick: base.tick, positions: base.positions,
      alive: base.alive, power: base.hunger, resources: base.food,
      integrity: this.integrity.slice(), wear: this.wear.slice(),
      failureCauses: this.failureCauses.map(v => v.slice()), hazardsActive: this.hazardsActive,
      hazardCells: this.hazardCells.map(cell => [Math.floor(cell/size), cell%size])};
  }
  state() {
    return structuredClone({version: SYNTHETIC_VERSION, config: this.config, seed: this.seed,
      base: this.base.state(), wear: this.wear, integrity: this.integrity,
      failureCauses: this.failureCauses, hazardCells: this.hazardCells});
  }
  loadState(state) {
    const c = this.config;
    if (state?.version !== SYNTHETIC_VERSION || Object.keys(c).some(k => state.config?.[k] !== c[k]) || state.seed !== this.seed ||
        !Array.isArray(state.wear) || state.wear.length !== c.agents || !state.wear.every(v => bounded(v, 0, c.wear_limit)) ||
        !Array.isArray(state.integrity) || state.integrity.length !== c.agents || !state.integrity.every(v => bounded(v, 0, c.max_integrity)) ||
        !Array.isArray(state.failureCauses) || state.failureCauses.length !== c.agents ||
        !state.failureCauses.every(v => Array.isArray(v) && v.every(x => ['power depletion', 'integrity failure', 'lifetime wear'].includes(x))) ||
        !Array.isArray(state.hazardCells) || state.hazardCells.length !== this.hazardCells.length ||
        new Set(state.hazardCells).size !== state.hazardCells.length || !state.hazardCells.every(v => bounded(v, 0, c.size**2-1))) throw new RangeError('Invalid synthetic checkpoint');
    if (state.wear.some((v, i) => state.base.alive[i] && (v >= c.wear_limit || state.integrity[i] <= 0)) ||
        state.wear.some(v => v > state.base.tick)) throw new RangeError('Inconsistent synthetic lifecycle');
    this.base.loadState(state.base);
    this.wear = state.wear.slice(); this.integrity = state.integrity.slice();
    this.failureCauses = state.failureCauses.map(v => v.slice()); this.hazardCells = state.hazardCells.slice();
  }
}
