import type { SimulationConfig, SimulationFrame } from './types';
export interface Ballot { voter: number; target: number; reason: string; source: 'rule' | 'llm' | 'agent' }
export interface Council { number: number; tick: number; ballots: Ballot[]; eliminated: number; tied: boolean }
export interface IslandFrame extends SimulationFrame { phase: 'survival' | 'council' | 'finished'; winner: number | null; rewards: number[]; councils: Council[] }
export class IslandGame {
  constructor(options?: {seed?: number; config?: Partial<SimulationConfig>; councilEvery?: number});
  world: {config: SimulationConfig}; seed: number; playing: boolean; done: boolean;
  councilEvery: number; remaining: number[]; phase: IslandFrame['phase'];
  reset(seed?: number): IslandFrame; frame(): IslandFrame; play(): void; pause(): void;
  setSpeed(speed: number): void; advance(): IslandFrame; ruleBallots(): Ballot[];
  resolveCouncil(ballots: Ballot[]): {frame: IslandFrame; rewards: number[]; done: boolean};
}
