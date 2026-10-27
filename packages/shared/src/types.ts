export type ParticipantId = 'a' | 'b'

export type Stage = 'open' | 'closed'

export type BidSource = 'manual' | 'autobroker'

export type RejectReason =
  | 'bad_message'
  | 'unknown_participant'
  | 'not_integer'
  | 'below_min'
  | 'already_leader'
  | 'lot_closed'
  | 'max_too_low'

export const PARTICIPANTS: Record<ParticipantId, string> = {
  a: 'Алексей',
  b: 'Марина',
}

export type ClientMessage =
  | { type: 'join'; participantId: ParticipantId }
  | { type: 'place_bid'; amount: number; clientBidId: string }
  | { type: 'set_autobroker'; maxAmount: number }
  | { type: 'remove_autobroker' }
  | { type: 'resync' }

export type PublicBid = {
  seq: number
  participantId: ParticipantId
  participantName: string
  amount: number
  at: number
  source: BidSource
}

export type Leader = {
  participantId: ParticipantId
  amount: number
}

export type Snapshot = {
  type: 'snapshot'
  seq: number
  serverNow: number
  stage: Stage
  startingPrice: number
  minStep: number
  endsAt: number
  leader: Leader | null
  bids: PublicBid[]
  onlineParticipantIds: ParticipantId[]
  autobroker: { maxAmount: number } | null
}

export type PublicEvent =
  | {
      type: 'bid_placed'
      seq: number
      bid: PublicBid
      leader: Leader | null
      endsAt: number
    }
  | { type: 'lot_closed'; seq: number; leader: Leader | null }
  | { type: 'presence'; onlineParticipantIds: ParticipantId[] }

export type PrivateEvent =
  | { type: 'bid_rejected'; clientBidId: string; reason: RejectReason }
  | { type: 'autobroker_set'; maxAmount: number }
  | { type: 'autobroker_removed' }
  | { type: 'error'; reason: RejectReason }

export type ServerMessage = Snapshot | PublicEvent | PrivateEvent
