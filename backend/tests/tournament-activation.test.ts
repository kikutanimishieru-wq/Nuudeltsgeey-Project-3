import { describe, expect, it, vi } from 'vitest';
import { assertTournamentOperationAvailable } from '../lib/tournament-activation';
import { assertTournamentIndependent } from '../lib/competition-authority';
import { configurationPolicy } from '../lib/tournament-configuration';
const tx=(data:object)=>({tournament:{findUnique:vi.fn().mockResolvedValue(data)},playerProfile:{findFirst:vi.fn().mockResolvedValue(null)}});
describe('configuration activation and host independence',()=>{
  it('blocks legacy admin workflows from activating new Phase 3 drafts',async()=>{
    await expect(assertTournamentOperationAvailable(tx({configurationPolicy,format:'5v5',style:'Open Bracket'}) as never,'event',true)).rejects.toThrow('TOURNAMENT_ACTIVATION_NOT_AVAILABLE');
  });
  it.each(['2v2','3v3'])('does not activate incomplete %s policy through legacy records',async format=>{
    await expect(assertTournamentOperationAvailable(tx({configurationPolicy:null,format,style:'Open Bracket'}) as never,'event',true)).rejects.toThrow('LEGACY_EVENT_REQUIRES_EXPLICIT_MIGRATION');
  });
  it('gates advanced styles without changing legacy data',async()=>{
    await expect(assertTournamentOperationAvailable(tx({configurationPolicy:null,format:'5v5',style:'Swiss System'}) as never,'event',true)).rejects.toThrow('ADVANCED_STYLE_NOT_AVAILABLE');
  });
  it('rejects a host adjudicating their own event even when they do not play',async()=>{
    await expect(assertTournamentIndependent(tx({hostUserId:'host'}) as never,'host','event')).rejects.toThrow('CONFLICT_OF_INTEREST');
    await expect(assertTournamentIndependent(tx({hostUserId:'other'}) as never,'reviewer','event')).resolves.toBeUndefined();
  });
});
