import { castaways } from './islandPresentation.ts'
import type { IslandFrame, Ballot } from './simulation/island-game.mjs'
import type { SimulationConfig } from './simulation/types'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface IslandLanguageModel { generate(messages: ChatMessage[], json: boolean): Promise<string> }
export interface CampMessage { speaker: number; recipient?: number; text: string; council: number }
export interface AgentThinking { text: string | null; partner: number; council: number; status: 'ready' | 'unavailable' }

// Keep the spoken line when a small model adds a speaker label or commentary.
export function cleanSpeech(text: string, speaker: number) {
  const label = new RegExp(`^\\*{0,2}${castaways[speaker].name}:\\*{0,2}\\s*`, 'i')
  return text.trim().split(/\n\s*\n/)[0].replace(label, '').replace(/^"([\s\S]*)"$/, '$1').trim().slice(0, 300)
}

// Council is public. The model receives public dialogue and its own status, not
// other players' private observations, hidden resources or a full world frame.
export function councilPrompt(frame: IslandFrame, config: SimulationConfig, speaker: number, history: CampMessage[], vote: boolean, thinking?: string | null): ChatMessage[] {
  if (!vote) return [
    {role:'system', content:`You write natural dialogue for characters in an island survival game. Return only one short spoken sentence, without explanations or speaker labels.`},
    {role:'user', content:`${castaways[speaker].name} wants to win the island game. ${castaways[speaker].style} Energy: ${frame.power[speaker]}/${config.power_limit}; health: ${frame.integrity[speaker]}/${config.max_integrity}. Current plan: ${thinking || 'Find support before the vote'}. Recent conversation: ${history.slice(-4).map(m => `${castaways[m.speaker].name}: ${m.text}`).join('\n') || 'Nobody has spoken yet.'}`},
  ]
  const remaining = frame.alive.flatMap((alive, i) => alive ? [`${i + 1}: ${castaways[i].name}`] : [])
  return [
    { role: 'system', content: `You are ${castaways[speaker].name}, player ${speaker + 1}, in a fictional island survival game. ${castaways[speaker].style} Your goal is to be the last remaining player: winner reward +1, everyone else 0. Never claim you know hidden game information. You cannot change rules or perform actions by talking. ${vote ? 'Cast one mandatory vote to eliminate another remaining player. Return only JSON: {"target": player_number, "reason": "one short sentence"}. No self-votes.' : 'Address another castaway at council in one brief sentence (under 30 words). Respond to the discussion when possible. You may negotiate, question someone or ask for support. Output only your spoken words.'}` },
    { role: 'user', content: `Council ${frame.councils.length + 1}, turn ${frame.tick}. Remaining players: ${remaining.join(', ')}. Your energy: ${frame.power[speaker]}/${config.power_limit}; health: ${frame.integrity[speaker]}/${config.max_integrity}; exposure: ${frame.wear[speaker]}/${config.wear_limit}.\nYour current stance: ${thinking || 'No conversation summary yet.'}\nPublic conversation:\n${history.slice(-16).map(m => `${castaways[m.speaker].name}: ${m.text}`).join('\n') || 'Nobody has spoken yet.'}\n${vote ? 'Choose another remaining player to vote out.' : 'Speak to the other castaways now.'}` },
  ]
}
export function parseBallot(text: string, voter: number, frame: IslandFrame): Ballot {
  const data = JSON.parse(text.trim()) as { target: number; reason: string }
  const target = data.target - 1
  if (!Number.isInteger(data.target) || target === voter || !frame.alive[target] || typeof data.reason !== 'string' || !data.reason.trim()) throw new Error('Invalid model vote')
  return {voter, target, reason: data.reason.trim().slice(0,300), source:'llm'}
}

// The caller owns cancellation and commits only a complete, validated round.
export async function generateCouncil(model: IslandLanguageModel, frame: IslandFrame, config: SimulationConfig,
  history: CampMessage[], fallback: Ballot[], active: () => boolean, onMessage: (message: CampMessage) => void,
  onThinking: (agent: number, state: AgentThinking) => void = () => {}, initialThinking: (AgentThinking | null)[] = [], onStatus: (text: string) => void = () => {}, afterExchange: () => Promise<void> = async () => {}) {
  const conversation = [...history], ballots: Ballot[] = [], thinking = [...initialThinking]
  const players = frame.alive.flatMap((alive, i) => alive ? [i] : [])
  for (const speaker of players) {
    if (!active()) throw new Error('Council cancelled')
    const recipient = players[(players.indexOf(speaker) + 1) % players.length]
    const prompt = councilPrompt(frame, config, speaker, conversation, false, thinking[speaker]?.text)
    prompt[1].content += `\nWrite one complete sentence that ${castaways[speaker].name} says to ${castaways[recipient].name} about sharing food, trust, or the upcoming vote.`
    onStatus(`${castaways[speaker].name} is preparing a message for ${castaways[recipient].name}…`)
    const text = cleanSpeech(await model.generate(prompt, false), speaker)
    if (!active()) throw new Error('Council cancelled')
    if (!text) throw new Error('The model returned no dialogue')
    const message = {speaker, recipient, text, council:frame.councils.length + 1}
    conversation.push(message); onMessage(message)
    const readingPause = afterExchange()
    // Refresh the two participants independently. Never pass another agent's private summary.
    await Promise.all([speaker, recipient].map(async agent => {
      const partner = agent === speaker ? recipient : speaker
      let summary: AgentThinking = {text:null, partner, council:message.council, status:'unavailable'}
      try {
        onStatus(`Updating ${castaways[agent].name}’s summary after the exchange…`)
        const response = await model.generate([
          {role:'system', content:`You are ${castaways[agent].name} in a fictional island game. After this exchange, report your brief current stance or next intention for a public game status card. This is a concise state summary, not step-by-step reasoning. Return a JSON object with a "summary" field containing your own short plan. Do not repeat these instructions or invent private information or actions.`},
          {role:'user', content:`Your previous stance: ${thinking[agent]?.text || 'None yet'}. Your energy ${frame.power[agent]}/${config.power_limit}, health ${frame.integrity[agent]}/${config.max_integrity}. ${castaways[speaker].name} just said to ${castaways[recipient].name}: ${text}. Your goal: win the game. Update your current stance.`},
        ], true)
        const parsed = JSON.parse(response) as {summary?: string}
        if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) throw new Error('Empty summary')
        summary = {...summary,text:parsed.summary.trim().slice(0,180),status:'ready'}
      } catch { if (!active()) throw new Error('Council cancelled') }
      if (!active()) throw new Error('Council cancelled')
      thinking[agent] = summary; onThinking(agent, summary)
    }))
    await readingPause
    if (!active()) throw new Error('Council cancelled')
  }
  for (let offset = 0; offset < players.length; offset += 4) {
    const batch = await Promise.all(players.slice(offset, offset + 4).map(async voter => {
    if (!active()) throw new Error('Council cancelled')
    try {
      onStatus(`${castaways[voter].name} is casting a vote…`)
      return parseBallot(await model.generate(councilPrompt(frame, config, voter, conversation, true, thinking[voter]?.text), true), voter, frame)
    } catch {
      if (!active()) throw new Error('Council cancelled')
      return {...fallback.find(v => v.voter === voter)!, reason:'Model vote unavailable or invalid; the seeded game rule supplied this mandatory vote.'}
    }
    }))
    ballots.push(...batch)
  }
  if (!active()) throw new Error('Council cancelled')
  return ballots
}
