import { PARTICIPANTS, type BidSource, type Leader, type ParticipantId, type PrivateEvent, type PublicBid, type PublicEvent, type RejectReason, type Stage } from './types'

/** Окно и длина антиснайпинга: ставка при остатке меньше этого сдвигает endsAt на now + это же значение. */
export const ANTI_SNIPE_MS = 30_000
export const STARTING_PRICE = 10_000
export const MIN_STEP = 500
export const LOT_DURATION_MS = 120_000

export type Autobroker = {
  maxAmount: number
  /** Момент установки потолка. При равном тике раньше выставленный ходит первым. */
  setAt: number
}

type LedgerEntry = {
  participantId: ParticipantId
  accepted: boolean
  reason?: RejectReason
}

export type AuctionState = {
  stage: Stage
  startingPrice: number
  minStep: number
  endsAt: number
  seq: number
  leader: Leader | null
  /** Сверху более новая ставка. */
  bids: PublicBid[]
  autobrokers: Partial<Record<ParticipantId, Autobroker>>
  bidLedger: Record<string, LedgerEntry>
  brokerSeq: number
}

export type Command =
  | {
      type: 'place_bid'
      participantId: ParticipantId
      amount: number
      clientBidId: string
      now: number
      source: BidSource
    }
  | {
      type: 'set_autobroker'
      participantId: ParticipantId
      maxAmount: number
      now: number
    }
  | {
      type: 'remove_autobroker'
      participantId: ParticipantId
      now: number
    }
  | { type: 'close_if_due'; now: number }

type DomainEvent = Extract<PublicEvent, { type: 'bid_placed' | 'lot_closed' }>

export type ApplyResult = {
  state: AuctionState
  publicEvents: DomainEvent[]
  privateEvents: PrivateEvent[]
  rejection?: { reason: RejectReason; clientBidId?: string }
  duplicate: boolean
}

type ApplyOptions = {
  /** false — принять одну ставку и не запускать ответ брокеров. Так цикл брокеров вызывает ту же apply. */
  chase?: boolean
}

export function createAuction(now: number): AuctionState {
  return {
    stage: 'open',
    startingPrice: STARTING_PRICE,
    minStep: MIN_STEP,
    endsAt: now + LOT_DURATION_MS,
    seq: 0,
    leader: null,
    bids: [],
    autobrokers: {},
    bidLedger: {},
    brokerSeq: 0,
  }
}

export function nextAmount(state: {
  leader: { amount: number } | null
  startingPrice: number
  minStep: number
}): number {
  if (state.leader) return state.leader.amount + state.minStep
  return state.startingPrice
}

export function apply(state: AuctionState, command: Command, options?: ApplyOptions): ApplyResult {
  if (command.type === 'close_if_due') return applyClose(state, command.now)
  if (command.type === 'remove_autobroker') return applyRemoveAutobroker(state, command)
  if (command.type === 'set_autobroker') return applySetAutobroker(state, command)

  const placed = placeBid(state, command)
  if (options?.chase === false || placed.rejection || placed.duplicate) return placed
  const chased = chaseBrokers(placed.state, command.now)
  return {
    state: chased.state,
    publicEvents: [...placed.publicEvents, ...chased.publicEvents],
    privateEvents: placed.privateEvents,
    duplicate: false,
  }
}

function applyClose(state: AuctionState, now: number): ApplyResult {
  const clock = ensureOpen(state, now)
  return {
    state: clock.state,
    publicEvents: clock.event ? [clock.event] : [],
    privateEvents: [],
    duplicate: false,
  }
}

function applyRemoveAutobroker(
  state: AuctionState,
  command: Extract<Command, { type: 'remove_autobroker' }>,
): ApplyResult {
  const clock = ensureOpen(state, command.now)
  if (!clock.open) return closedRejection(clock)

  if (!clock.state.autobrokers[command.participantId]) {
    return {
      state: clock.state,
      publicEvents: [],
      privateEvents: [{ type: 'autobroker_removed' }],
      duplicate: false,
    }
  }

  const autobrokers = { ...clock.state.autobrokers }
  delete autobrokers[command.participantId]
  return {
    state: { ...clock.state, autobrokers },
    publicEvents: [],
    privateEvents: [{ type: 'autobroker_removed' }],
    duplicate: false,
  }
}

function applySetAutobroker(
  state: AuctionState,
  command: Extract<Command, { type: 'set_autobroker' }>,
): ApplyResult {
  const clock = ensureOpen(state, command.now)
  if (!clock.open) return closedRejection(clock)

  if (!isPositiveInteger(command.maxAmount)) return failure(clock.state, 'not_integer')

  const isLeader = clock.state.leader?.participantId === command.participantId
  const floor = isLeader ? clock.state.leader!.amount : nextAmount(clock.state)
  if (command.maxAmount < floor) return failure(clock.state, 'max_too_low')

  const saved: AuctionState = {
    ...clock.state,
    autobrokers: {
      ...clock.state.autobrokers,
      [command.participantId]: { maxAmount: command.maxAmount, setAt: command.now },
    },
  }
  const chased = chaseBrokers(saved, command.now)
  return {
    state: chased.state,
    publicEvents: chased.publicEvents,
    privateEvents: [{ type: 'autobroker_set', maxAmount: command.maxAmount }],
    duplicate: false,
  }
}

function placeBid(state: AuctionState, command: Extract<Command, { type: 'place_bid' }>): ApplyResult {
  const prior = state.bidLedger[command.clientBidId]
  if (prior) return duplicateOf(state, command.clientBidId, prior)

  const clock = ensureOpen(state, command.now)
  if (!clock.open) return rejectBid(clock.state, command, 'lot_closed', clock.event ? [clock.event] : [])

  // Порядок: лот открыт, положительное целое, отправитель не лидер, сумма не ниже порога.
  if (!isPositiveInteger(command.amount)) return rejectBid(clock.state, command, 'not_integer')
  if (clock.state.leader?.participantId === command.participantId) {
    return rejectBid(clock.state, command, 'already_leader')
  }
  if (command.amount < nextAmount(clock.state)) return rejectBid(clock.state, command, 'below_min')

  return acceptBid(clock.state, command)
}

function chaseBrokers(state: AuctionState, now: number): { state: AuctionState; publicEvents: DomainEvent[] } {
  let current = state
  const publicEvents: DomainEvent[] = []

  for (let guard = 0; guard < 100_000; guard += 1) {
    const actor = pickBroker(current)
    if (!actor) return { state: current, publicEvents }
    const price = nextAmount(current)
    const result = apply(
      current,
      {
        type: 'place_bid',
        participantId: actor,
        amount: price,
        clientBidId: `broker:${actor}:${current.brokerSeq + 1}`,
        now,
        source: 'autobroker',
      },
      { chase: false },
    )
    publicEvents.push(...result.publicEvents)
    current = result.state
    if (result.rejection || current.stage === 'closed') return { state: current, publicEvents }
    if ((current.leader?.amount ?? 0) < price) return { state: current, publicEvents }
  }

  throw new Error('Autobroker chase did not finish')
}

function pickBroker(state: AuctionState): ParticipantId | null {
  if (state.stage !== 'open') return null
  const price = nextAmount(state)
  const candidates = (['a', 'b'] as const).filter((id) => {
    const broker = state.autobrokers[id]
    if (!broker) return false
    if (state.leader?.participantId === id) return false
    return broker.maxAmount >= price
  })
  candidates.sort((left, right) => {
    const byTime = state.autobrokers[left]!.setAt - state.autobrokers[right]!.setAt
    if (byTime !== 0) return byTime
    return left < right ? -1 : 1
  })
  return candidates[0] ?? null
}

function acceptBid(state: AuctionState, command: Extract<Command, { type: 'place_bid' }>): ApplyResult {
  const seq = state.seq + 1
  const endsAt = state.endsAt - command.now < ANTI_SNIPE_MS ? command.now + ANTI_SNIPE_MS : state.endsAt
  const bid: PublicBid = {
    seq,
    participantId: command.participantId,
    participantName: PARTICIPANTS[command.participantId],
    amount: command.amount,
    at: command.now,
    source: command.source,
  }
  const leader: Leader = { participantId: command.participantId, amount: command.amount }
  const next: AuctionState = {
    ...state,
    seq,
    endsAt,
    leader,
    bids: [bid, ...state.bids],
    brokerSeq: command.source === 'autobroker' ? state.brokerSeq + 1 : state.brokerSeq,
    bidLedger: {
      ...state.bidLedger,
      [command.clientBidId]: { participantId: command.participantId, accepted: true },
    },
  }
  const event: DomainEvent = { type: 'bid_placed', seq, bid, leader, endsAt }
  return { state: next, publicEvents: [event], privateEvents: [], duplicate: false }
}

function rejectBid(
  state: AuctionState,
  command: Extract<Command, { type: 'place_bid' }>,
  reason: RejectReason,
  publicEvents: DomainEvent[] = [],
): ApplyResult {
  return {
    state: {
      ...state,
      bidLedger: {
        ...state.bidLedger,
        [command.clientBidId]: {
          participantId: command.participantId,
          accepted: false,
          reason,
        },
      },
    },
    publicEvents,
    privateEvents: [{ type: 'bid_rejected', clientBidId: command.clientBidId, reason }],
    rejection: { reason, clientBidId: command.clientBidId },
    duplicate: false,
  }
}

function duplicateOf(state: AuctionState, clientBidId: string, prior: LedgerEntry): ApplyResult {
  if (prior.accepted) {
    return { state, publicEvents: [], privateEvents: [], duplicate: true }
  }
  const reason = prior.reason ?? 'bad_message'
  return {
    state,
    publicEvents: [],
    privateEvents: [{ type: 'bid_rejected', clientBidId, reason }],
    rejection: { reason, clientBidId },
    duplicate: true,
  }
}

function failure(state: AuctionState, reason: RejectReason, publicEvents: DomainEvent[] = []): ApplyResult {
  return {
    state,
    publicEvents,
    privateEvents: [{ type: 'error', reason }],
    rejection: { reason },
    duplicate: false,
  }
}

type Clock =
  | { open: true; state: AuctionState; event?: undefined }
  | { open: false; state: AuctionState; event?: Extract<DomainEvent, { type: 'lot_closed' }> }

function ensureOpen(state: AuctionState, now: number): Clock {
  if (state.stage === 'closed') return { open: false, state }
  if (now < state.endsAt) return { open: true, state }
  const seq = state.seq + 1
  const closed: AuctionState = { ...state, stage: 'closed', seq }
  return {
    open: false,
    state: closed,
    event: { type: 'lot_closed', seq, leader: closed.leader },
  }
}

function closedRejection(clock: Extract<Clock, { open: false }>): ApplyResult {
  return failure(clock.state, 'lot_closed', clock.event ? [clock.event] : [])
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
