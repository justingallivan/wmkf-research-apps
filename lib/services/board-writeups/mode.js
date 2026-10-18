/** One mail-owner mode; disabling Board work never resurrects the old digest. */
export function boardMode(env = process.env) {
  const mode = env.RESEARCH_LEADERSHIP_DIGEST_MODE || 'legacy';
  return ['legacy', 'board-release', 'paused'].includes(mode) ? mode : 'paused';
}
export function boardWorkEnabled(env = process.env) {
  return boardMode(env) === 'board-release' && env.BOARD_WRITEUPS_ENABLED === 'on';
}
