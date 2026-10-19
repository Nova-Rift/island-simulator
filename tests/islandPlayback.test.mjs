import test from 'node:test'
import assert from 'node:assert/strict'
import { IslandGame } from '../src/simulation/island-game.mjs'
import { IslandPlayback } from '../src/islandPlayback.ts'
import { generateCouncil } from '../src/islandLanguage.ts'

function start() {
  const game = new IslandGame({ seed: 0 })
  const playback = new IslandPlayback(game)
  playback.play()
  for (let i = 0; i < 8; i++) playback.advance()
  assert.equal(game.phase, 'council')
  assert.equal(game.frame().tick, 8)
  return { game, playback }
}
test('one Play crosses turn eight, generates council speech, votes and resumes at turn nine', async () => {
  const { game, playback } = start()
  assert.equal(playback.running, true)
  assert.equal(game.playing, false) // world must wait while language generation runs
  assert.equal(playback.advance().tick, 8)
  const messages = [], summaries = [], status = []
  const model = { generate: async (_, json) => json ? '{"summary":"I will seek support."}' : 'Can we agree on a vote?' }
  const votes = await generateCouncil(model, game.frame(), game.world.config, [], game.ruleBallots(),
    () => true, message => messages.push(message), (...args) => summaries.push(args), [], text => status.push(text))
  assert.equal(messages.length, game.remaining.length)
  assert.equal(summaries.length, messages.length * 2)
  assert.ok(status.some(text => text.includes('casting a vote')))
  playback.resolveCouncil(votes)
  assert.equal(playback.running, true)
  assert.equal(playback.advance().tick, 9)
})
test('silent play also crosses councils and reaches a terminal result without repeated Play clicks', () => {
  const { game, playback } = start()
  for (let i = 0; i < 200 && playback.running; i++) {
    if (game.phase === 'council') playback.resolveCouncil(game.ruleBallots())
    else playback.advance()
  }
  assert.equal(game.done, true)
  assert.equal(playback.running, false)
  assert.ok(game.frame().tick > 8)
  assert.ok(game.councils.length > 1)
})
test('Pause during a council prevents automatic movement after its vote completes', () => {
  const { game, playback } = start()
  playback.pause()
  playback.resolveCouncil(game.ruleBallots())
  assert.equal(playback.running, false)
  assert.equal(playback.advance().tick, 8)
  playback.play()
  assert.equal(playback.advance().tick, 9)
})
test('reset clears playback intent and returns to turn zero', () => {
  const { playback } = start()
  assert.equal(playback.reset(1).tick, 0)
  assert.equal(playback.running, false)
  assert.equal(playback.advance().tick, 0)
})
