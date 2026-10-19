/** Small testable coordinator: stepping is independent of wall clock and Canvas. */
import {SyntheticWorld} from './synthetic.mjs';
import {createScriptedController} from './scripted.mjs';

export class DemoRuntime {
  constructor({seed = 0, config = {}} = {}) {
    this.config = config; this.speed = 1; this.reset(seed);
  }
  reset(seed = this.seed) {
    this.world = new SyntheticWorld({seed, config: this.config}); this.seed = seed;
    this.controller = createScriptedController({agents: this.world.config.agents, radius: this.world.config.radius, seed});
    this.playing = false; return this.world.frame();
  }
  play() { this.playing = !this.world.done; }
  pause() { this.playing = false; }
  setSpeed(speed) {
    if (![.5, 1, 2, 4].includes(speed)) throw new RangeError('Unsupported display speed');
    this.speed = speed;
  }
  advance() {
    if (this.playing && !this.world.done) {
      this.world.step(this.controller.actions(this.world.observe()));
      if (this.world.done) this.pause();
    }
    return this.world.frame();
  }
}
