export interface SimulationConfig {
  size: number; agents: number; radius: number; power_limit: number;
  initial_resources: number; resources_per_step: number; horizon: number;
  wear_limit: number; max_integrity: number; hazard_count: number;
  hazard_damage: number; hazard_period: number;
}
export interface SimulationFrame {
  version: string; tick: number; positions: number[][]; alive: boolean[];
  power: number[]; resources: number[][]; integrity: number[]; wear: number[];
  failureCauses: string[][]; hazardsActive: boolean; hazardCells: number[][];
}
