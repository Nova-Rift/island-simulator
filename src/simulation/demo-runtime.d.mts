import type { SimulationConfig, SimulationFrame } from './types';
export class DemoRuntime {
  constructor(options?: { seed?: number; config?: Partial<SimulationConfig> });
  seed: number; speed: number; playing: boolean;
  world: { config: SimulationConfig; done: boolean; frame(): SimulationFrame };
  reset(seed?: number): SimulationFrame;
  play(): void; pause(): void; setSpeed(speed: number): void;
  advance(): SimulationFrame;
}
