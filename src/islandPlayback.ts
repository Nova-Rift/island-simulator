import type { IslandGame, Ballot } from './simulation/island-game.mjs'

// Playback intent spans the game's mandatory council pause. The environment
// still cannot advance while votes are pending; only the UI decides to resume.
export class IslandPlayback {
  running = false
  private game: IslandGame
  constructor(game: IslandGame) { this.game = game }
  play() { this.running = !this.game.done; this.game.play() }
  pause() { this.running = false; this.game.pause() }
  advance() {
    const frame = this.game.advance()
    if (this.game.done) this.running = false
    return frame
  }
  resolveCouncil(ballots: Ballot[]) {
    const { frame } = this.game.resolveCouncil(ballots)
    if (this.game.done) this.running = false
    else if (this.running) this.game.play()
    return frame
  }
  reset(seed: number) { this.pause(); return this.game.reset(seed) }
}
