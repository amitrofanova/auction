import type { AuctionState } from './apply'
import type { ParticipantId, Snapshot } from './types'

/** Снимок для одного участника: чужой потолок автоброкера не отдаём. */
export function toSnapshot(
  state: AuctionState,
  participantId: ParticipantId,
  onlineParticipantIds: ParticipantId[],
  serverNow: number,
): Snapshot {
  const broker = state.autobrokers[participantId]
  return {
    type: 'snapshot',
    seq: state.seq,
    serverNow,
    stage: state.stage,
    startingPrice: state.startingPrice,
    minStep: state.minStep,
    endsAt: state.endsAt,
    leader: state.leader ? { ...state.leader } : null,
    bids: state.bids.slice(),
    onlineParticipantIds: onlineParticipantIds.slice(),
    autobroker: broker ? { maxAmount: broker.maxAmount } : null,
  }
}
