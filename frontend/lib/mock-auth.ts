/** Presentation-only state. Never evidence of a backend session or authorization. */
export type MockPhase = 'signed-out' | 'authenticating' | 'failed' | 'discord-only' | 'verified' | 'restricted';
export type MockState = Readonly<{ phase: MockPhase }>;
export type MockAction = { type: 'BEGIN' | 'SUCCESS' | 'FAIL' | 'CONNECT_STEAM' | 'RESET' } | { type: 'PREVIEW'; phase: MockPhase };
export const initialMockState: MockState = { phase: 'signed-out' };
export const mockPhases: readonly MockPhase[] = ['signed-out', 'authenticating', 'failed', 'discord-only', 'verified', 'restricted'];
export function mockAuthReducer(state: MockState, action: MockAction): MockState {
  if (action.type === 'RESET') return initialMockState;
  if (action.type === 'PREVIEW') return mockPhases.includes(action.phase) ? { phase: action.phase } : initialMockState;
  if (action.type === 'BEGIN' && ['signed-out', 'failed'].includes(state.phase)) return { phase: 'authenticating' };
  if (action.type === 'SUCCESS' && state.phase === 'authenticating') return { phase: 'discord-only' };
  if (action.type === 'FAIL' && state.phase === 'authenticating') return { phase: 'failed' };
  if (action.type === 'CONNECT_STEAM' && state.phase === 'discord-only') return { phase: 'verified' };
  return state;
}
export function mockPresentation(state: MockState) {
  const discord = ['discord-only', 'verified', 'restricted'].includes(state.phase);
  const steam = ['verified', 'restricted'].includes(state.phase);
  const restricted = state.phase === 'restricted';
  const eligible = discord && steam && !restricted;
  return { signedIn: discord, discord, steam, restricted, browse: true, host: eligible, join: eligible,
    nickname: 'MongolWarrior', publicNmdId: 'NMD-DEMO-000001', discordName: 'MongolWarrior (демо)' };
}
