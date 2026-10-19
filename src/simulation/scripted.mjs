/** Identical local-only scripted policy for every agent; no learned cooperation. */
import {MOVES, SeededRandom} from './simulator.mjs';

export function createScriptedController({agents, radius, seed = 0}) {
  const random = Array.from({length: agents}, (_, i) => new SeededRandom((seed+i*1009) >>> 0));
  const width = 2*radius+1, plane = width**2, center = radius*width+radius;
  return {actions(observations) {
    if (!Array.isArray(observations) || observations.length !== agents || observations.some(o => !(o instanceof Float32Array) || o.length !== 8*plane)) throw new TypeError('Synthetic local observations required');
    return observations.map((obs, i) => {
      if (!obs[plane+center]) return 0;
      const food = [];
      for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (obs[y*width+x]) food.push([y, x]);
      const scores = [];
      for (let action = 0; action < 5; action++) {
        const [dy, dx] = MOVES[action], y = radius+dy, x = radius+dx;
        if (y < 0 || y >= width || x < 0 || x >= width) continue;
        const cell = y*width+x;
        if (!obs[3*plane+cell] || obs[2*plane+cell]) continue;
        const hazard = obs[5*plane+cell] ? 1000 : 0;
        const distance = food.length ? Math.min(...food.map(([fy, fx]) => Math.abs(fy-y)+Math.abs(fx-x))) : 0;
        scores.push({action, score: hazard+distance});
      }
      const best = Math.min(...scores.map(v => v.score));
      const choices = scores.filter(v => v.score === best);
      return choices[Math.floor(random[i].next()*choices.length)].action;
    });
  }};
}
