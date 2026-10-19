export interface SpeechItem { speaker: number; recipient?: number; text: string; council: number }
export interface SpeechPlacement { message: SpeechItem; x: number; y: number; width: number; height: number; anchorX: number; anchorY: number }

// Newest speaker first. Never overlap boxes; omit older messages when space runs out.
export function placeSpeechBubbles(messages: SpeechItem[], positions: number[][], size: number, width: number, height: number): SpeechPlacement[] {
  if (width < 120 || height < 100) return []
  const gap = 8, boxWidth = Math.min(242, width - gap * 2), boxHeight = Math.min(130, height - gap * 2)
  const placed: SpeechPlacement[] = [], seen = new Set<number>()
  for (const message of messages.slice().reverse()) {
    if (seen.has(message.speaker) || !positions[message.speaker]) continue
    seen.add(message.speaker)
    const [row, col] = positions[message.speaker]
    const anchorX = (col + .5) / size * width, anchorY = (row + .5) / size * height
    const candidates = [
      [anchorX-boxWidth/2,anchorY-boxHeight-18], [anchorX-boxWidth/2,anchorY+18],
      [anchorX+18,anchorY-boxHeight/2], [anchorX-boxWidth-18,anchorY-boxHeight/2],
      [gap,gap], [width-boxWidth-gap,gap], [gap,height-boxHeight-gap], [width-boxWidth-gap,height-boxHeight-gap],
    ]
    for (const [cx,cy] of candidates) {
      const x = Math.max(gap,Math.min(width-boxWidth-gap,cx)), y = Math.max(gap,Math.min(height-boxHeight-gap,cy))
      if (placed.some(p => x < p.x+p.width+gap && x+boxWidth+gap > p.x && y < p.y+p.height+gap && y+boxHeight+gap > p.y)) continue
      placed.push({message,x,y,width:boxWidth,height:boxHeight,anchorX,anchorY}); break
    }
    if (placed.length === 3) break
  }
  return placed
}
