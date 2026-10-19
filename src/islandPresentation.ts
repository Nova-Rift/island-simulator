import type { SimulationConfig, SimulationFrame } from './simulation/types'

export const castaways = [
  { name: 'Maya', style: 'Practical and encouraging; looks out for tired neighbors.' },
  { name: 'Theo', style: 'Competitive but fair; likes to compare survival strategies.' },
  { name: 'Nia', style: 'Observant and cautious; notices nearby dangers.' },
  { name: 'Leo', style: 'Upbeat and sociable; tries to keep morale high.' },
  { name: 'Ava', style: 'Direct and resourceful; focuses on finding food.' },
  { name: 'Sam', style: 'Patient and thoughtful; asks other players how they are doing.' },
  { name: 'Iris', style: 'Curious and analytical; talks through what she can see.' },
  { name: 'Kai', style: 'Calm and independent; prefers short, useful advice.' },
]
export function eliminationReason(causes: string[]) {
  const labels: Record<string, string> = { 'power depletion': 'Out of energy', 'integrity failure': 'Health depleted', 'lifetime wear': 'Exposure limit reached', 'voted out': 'Voted off the island' }
  return causes.map(cause => labels[cause] ?? cause).join(' + ')
}
export function castawayActivity(before: SimulationFrame, after: SimulationFrame, config: SimulationConfig, i: number) {
  if (!after.alive[i]) return eliminationReason(after.failureCauses[i])
  if (after.tick !== before.tick + 1) return 'Scouting for food'
  const events = []
  if (after.power[i] === config.power_limit) events.push('Gathering fruit')
  if (after.integrity[i] < before.integrity[i]) events.push('Caught in a storm')
  if (events.length) return events.join(' · ')
  const [y, x] = after.positions[i], [oldY, oldX] = before.positions[i]
  if (y !== oldY || x !== oldX) return 'Exploring the island'
  return 'Waiting here'
}
export function cellAt(x: number, y: number, width: number, height: number, size: number): [number, number] | null {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return null
  return [Math.floor(y / height * size), Math.floor(x / width * size)]
}
export function describeCell(frame: SimulationFrame, config: SimulationConfig, row: number, col: number, activity: string[]) {
  const entries: { title: string; detail: string }[] = []
  frame.positions.forEach(([y, x], i) => {
    if (y === row && x === col) entries.push({ title: `#${i + 1} ${castaways[i].name}${frame.alive[i] ? '' : ' · eliminated'}`,
      detail: `${frame.alive[i] ? activity[i] : eliminationReason(frame.failureCauses[i])}. Energy ${frame.power[i]}/${config.power_limit}; health ${frame.integrity[i]}/${config.max_integrity}; exposure ${frame.wear[i]}/${config.wear_limit}.` })
  })
  if (frame.resources.some(([y, x]) => y === row && x === col)) entries.push({ title: 'Wild fruit', detail: `One shared portion. Collecting it restores energy to ${config.power_limit}; only one castaway can take it.` })
  if (frame.hazardCells.some(([y, x]) => y === row && x === col)) entries.push({ title: frame.hazardsActive ? 'Storm · dangerous now' : 'Storm zone · calm now', detail: `Storms switch every ${config.hazard_period / 2} turns. An active storm costs ${config.hazard_damage} health each turn spent here.` })
  if (!entries.length) entries.push({ title: Math.min(row, col, config.size - 1 - row, config.size - 1 - col) < 2 ? 'Sandy beach' : 'Island clearing', detail: 'Open ground. Walking or waiting costs 1 energy per turn. Fruit can grow here; players cannot share a cell.' })
  return entries
}
