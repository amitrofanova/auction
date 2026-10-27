import type {
  Leader,
  ParticipantId,
  PrivateEvent,
  PublicBid,
  PublicEvent,
  RejectReason,
  ServerMessage,
  Snapshot,
  Stage,
} from '@auction/shared'

export type ViewState = {
  ready: boolean
  lastSeq: number
  stage: Stage
  startingPrice: number
  minStep: number
  endsAt: number
  leader: Leader | null
  bids: PublicBid[]
  onlineParticipantIds: ParticipantId[]
  autobroker: { maxAmount: number } | null
  /** serverNow - Date.now() на момент снимка. Таймер считается от него, не от часов вкладки. */
  clockOffset: number
}

export type ReduceResult = {
  state: ViewState
  /** Дыра в seq: локальное состояние не дорисовываем, нужен новый снимок. */
  resync: boolean
}

const SERVER_TYPES = new Set<ServerMessage['type']>([
  'snapshot',
  'bid_placed',
  'lot_closed',
  'presence',
  'bid_rejected',
  'autobroker_set',
  'autobroker_removed',
  'error',
])

export function emptyView(): ViewState {
  return {
    ready: false,
    lastSeq: 0,
    stage: 'open',
    startingPrice: 10_000,
    minStep: 500,
    endsAt: 0,
    leader: null,
    bids: [],
    onlineParticipantIds: [],
    autobroker: null,
    clockOffset: 0,
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && SERVER_TYPES.has(type as ServerMessage['type'])
}

/**
 * Снимок заменяет состояние целиком.
 * Публичное событие применяется только при seq = lastSeq + 1.
 * Любой другой номер — сигнал запросить снимок, без попытки заполнить дыру.
 * Пока снимка нет, промежуточные события отбрасываются.
 */
export function reduceAuction(state: ViewState, message: ServerMessage, now: number): ReduceResult {
  if (message.type === 'snapshot') return { state: applySnapshot(message, now), resync: false }
  if (!state.ready) return { state, resync: false }

  if (message.type === 'presence') {
    return { state: { ...state, onlineParticipantIds: message.onlineParticipantIds }, resync: false }
  }

  if (message.type === 'bid_placed' || message.type === 'lot_closed') {
    if (message.seq !== state.lastSeq + 1) {
      return { state: { ...state, ready: false }, resync: true }
    }
    return { state: applySequenced(state, message), resync: false }
  }

  return { state: applyPrivate(state, message), resync: false }
}

function applySnapshot(message: Snapshot, now: number): ViewState {
  return {
    ready: true,
    lastSeq: message.seq,
    stage: message.stage,
    startingPrice: message.startingPrice,
    minStep: message.minStep,
    endsAt: message.endsAt,
    leader: message.leader,
    bids: message.bids,
    onlineParticipantIds: message.onlineParticipantIds,
    autobroker: message.autobroker,
    clockOffset: message.serverNow - now,
  }
}

function applySequenced(state: ViewState, message: Extract<PublicEvent, { type: 'bid_placed' | 'lot_closed' }>): ViewState {
  if (message.type === 'lot_closed') {
    return {
      ...state,
      lastSeq: message.seq,
      stage: 'closed',
      leader: message.leader,
    }
  }
  return {
    ...state,
    lastSeq: message.seq,
    leader: message.leader,
    endsAt: message.endsAt,
    bids: [message.bid, ...state.bids],
  }
}

function applyPrivate(state: ViewState, message: PrivateEvent): ViewState {
  if (message.type === 'autobroker_set') {
    return { ...state, autobroker: { maxAmount: message.maxAmount } }
  }
  if (message.type === 'autobroker_removed') {
    return { ...state, autobroker: null }
  }
  return state
}

export function reasonText(reason: RejectReason): string {
  switch (reason) {
    case 'bad_message':
      return 'Некорректное сообщение'
    case 'unknown_participant':
      return 'Неизвестный участник'
    case 'not_integer':
      return 'Нужна целая сумма больше нуля'
    case 'below_min':
      return 'Ставка ниже допустимой'
    case 'already_leader':
      return 'Нельзя перебить свою ставку'
    case 'lot_closed':
      return 'Лот уже закрыт'
    case 'max_too_low':
      return 'Потолок ниже допустимой цены'
  }
}
