/** island-survival-v1: a separate game objective; synthetic-v2 stays unchanged. */
import {SyntheticWorld} from './synthetic.mjs';
import {createScriptedController} from './scripted.mjs';
export const ISLAND_VERSION = 'island-survival-v1';
export class IslandGame {
  constructor({seed = 0, config = {}, councilEvery = 8} = {}) {
    if (!Number.isInteger(councilEvery) || councilEvery < 1 || councilEvery > 12) throw new RangeError('Council interval must be 1–12 turns');
    this.config = config; this.councilEvery = councilEvery; this.speed = 1; this.reset(seed);
  }
  reset(seed = this.seed) {
    this.world = new SyntheticWorld({seed, config: this.config}); this.seed = seed;
    this.controller = createScriptedController({agents: this.world.config.agents, radius: this.world.config.radius, seed});
    this.playing = false; this.phase = 'survival'; this.councils = []; this.votedOut = [];
    this.winner = null; this.rewards = Array(this.world.config.agents).fill(0);
    this.finishIfNeeded(); return this.frame();
  }
  get done() { return this.phase === 'finished'; }
  get remaining() { return this.world.base.alive.flatMap((alive, i) => alive ? [i] : []); }
  play() { this.playing = !this.done && this.phase === 'survival'; }
  pause() { this.playing = false; }
  setSpeed(speed) { if (![.5,1,2,4].includes(speed)) throw new RangeError('Unsupported display speed'); this.speed = speed; }
  finishIfNeeded() {
    if (this.remaining.length <= 1 || this.world.done) {
      this.phase = 'finished'; this.pause();
      this.winner = this.remaining.length === 1 ? this.remaining[0] : null;
      if (this.winner !== null) this.rewards[this.winner] = 1;
    }
  }
  step(actions) {
    if (this.done || this.phase !== 'survival') throw new Error('Survival is not active');
    this.world.step(actions); this.finishIfNeeded();
    if (!this.done && this.world.tick % this.councilEvery === 0) { this.phase = 'council'; this.pause(); }
    return {frame: this.frame(), rewards: this.rewards.slice(), done: this.done};
  }
  advance() {
    if (this.playing && this.phase === 'survival') this.step(this.controller.actions(this.world.observe()));
    return this.frame();
  }
  // Transparent deterministic fallback when a language model is unavailable.
  ruleBallots() {
    if (this.phase !== 'council') throw new Error('No council in progress');
    const voters = this.remaining;
    return voters.map(voter => {
      const candidates = voters.filter(i => i !== voter);
      const target = candidates[((this.seed + 1) * 17 + (voter + 1) * 31 + this.councils.length * 13) % candidates.length];
      return {voter, target, reason: 'Seeded game-rule vote; no language model decision.', source: 'rule'};
    });
  }
  resolveCouncil(ballots) {
    if (this.phase !== 'council') throw new Error('No council in progress');
    const voters = this.remaining;
    // Validate the entire round before any mutation: everyone votes exactly once.
    if (!Array.isArray(ballots) || ballots.length !== voters.length || new Set(ballots.map(v => v.voter)).size !== voters.length ||
      ballots.some(v => !voters.includes(v.voter) || !voters.includes(v.target) || v.voter === v.target ||
        !['rule','llm','agent'].includes(v.source) || typeof v.reason !== 'string' || v.reason.length > 300)) throw new RangeError('Each remaining castaway must cast one valid non-self vote');
    const totals = new Map(voters.map(i => [i, 0]));
    for (const ballot of ballots) totals.set(ballot.target, totals.get(ballot.target) + 1);
    const highest = Math.max(...totals.values());
    const tied = voters.filter(i => totals.get(i) === highest);
    // Reproducible lot among tied candidates; never lower player-number preference.
    const eliminated = tied[((this.seed + 1) * 97 + (this.councils.length + 1) * 53) % tied.length];
    const round = {number: this.councils.length + 1, tick: this.world.tick, ballots: structuredClone(ballots), eliminated, tied: tied.length > 1};
    this.councils.push(round); this.votedOut.push(eliminated);
    this.world.base.alive[eliminated] = false; this.world.base.hunger[eliminated] = 0;
    this.phase = 'survival'; this.finishIfNeeded();
    return {frame: this.frame(), rewards: this.rewards.slice(), done: this.done};
  }
  frame() {
    const frame = this.world.frame(); frame.version = ISLAND_VERSION;
    for (const i of this.votedOut) frame.failureCauses[i] = ['voted out'];
    return {...frame, phase: this.phase, winner: this.winner, rewards: this.rewards.slice(), councils: structuredClone(this.councils)};
  }
}
