/** Phones have no keyboard: drop the trailing key hint of a label. "Scoreboard (TAB)" -> "Scoreboard", "Buy weapons · B" -> "Buy weapons". */
export function stripKeyHint(label: string): string {
  return label.replace(/\s*\([^)]*\)$/, '').replace(/\s*·\s*[A-Z0-9~]$/, '')
}
