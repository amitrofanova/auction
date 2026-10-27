import type { ClientMessage, ParticipantId, ServerMessage } from '@auction/shared'
import { nextAmount, PARTICIPANTS } from '@auction/shared'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { emptyView, isServerMessage, reasonText, reduceAuction, type ViewState } from './reconcile'

export type ConnectionStatus = 'восстанавливаем' | 'подключено' | 'состояние синхронизировано'

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export function useAuction() {
  const participantId = ref<ParticipantId>('a')
  const view = ref<ViewState>(emptyView())
  const status = ref<ConnectionStatus>('восстанавливаем')
  const banner = ref('')
  const sending = ref(false)
  const bidError = ref('')
  const brokerError = ref('')
  const tick = ref(Date.now())

  let generation = 0
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let pendingBidId: string | null = null
  let everConnected = false
  let interrupted = false

  const you = computed(() => PARTICIPANTS[participantId.value])
  const minimum = computed(() =>
    nextAmount({
      leader: view.value.leader,
      startingPrice: view.value.startingPrice,
      minStep: view.value.minStep,
    }),
  )
  const leaderIsMe = computed(() => view.value.leader?.participantId === participantId.value)
  const timerLabel = computed(() => {
    if (!view.value.ready) return '—'
    if (view.value.stage === 'closed') return 'закрыт'
    const serverNow = tick.value + view.value.clockOffset
    return view.value.endsAt - serverNow
  })

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function scheduleRetry(gen: number) {
    clearRetry()
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (gen !== generation) return
      openSocket()
    }, 400)
  }

  function openSocket() {
    clearRetry()
    const gen = ++generation
    const previous = socket
    socket = null
    if (previous && (previous.readyState === WebSocket.OPEN || previous.readyState === WebSocket.CONNECTING)) {
      previous.close()
    }

    view.value = { ...view.value, ready: false }
    if (everConnected) status.value = 'восстанавливаем'

    const ws = new WebSocket(socketUrl())
    socket = ws

    ws.onopen = () => {
      if (gen !== generation) return
      const join: ClientMessage = { type: 'join', participantId: participantId.value }
      ws.send(JSON.stringify(join))
    }

    ws.onmessage = (event) => {
      if (gen !== generation) return
      onPayload(String(event.data))
    }

    ws.onclose = () => {
      if (gen !== generation) return
      status.value = 'восстанавливаем'
      if (everConnected) interrupted = true
      scheduleRetry(gen)
    }
  }

  function onPayload(raw: string) {
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    if (!isServerMessage(payload)) return
    const now = Date.now()
    const reduced = reduceAuction(view.value, payload, now)
    view.value = reduced.state
    tick.value = now

    if (payload.type === 'snapshot') {
      sending.value = false
      pendingBidId = null
      if (interrupted) {
        status.value = 'состояние синхронизировано'
        banner.value = 'соединение потеряно, состояние восстановлено'
        interrupted = false
      } else if (!banner.value) {
        status.value = 'подключено'
      }
      everConnected = true
    }

    if (reduced.resync) {
      const current = socket
      if (current && current.readyState === WebSocket.OPEN) {
        const resync: ClientMessage = { type: 'resync' }
        current.send(JSON.stringify(resync))
      }
      return
    }

    notePrivate(payload)
  }

  function notePrivate(message: ServerMessage) {
    if (message.type === 'bid_rejected' && message.clientBidId === pendingBidId) {
      sending.value = false
      pendingBidId = null
      bidError.value = reasonText(message.reason)
      return
    }
    if (message.type === 'bid_placed' || message.type === 'lot_closed') {
      if (
        message.type === 'bid_placed' &&
        message.bid.source === 'manual' &&
        message.bid.participantId === participantId.value &&
        pendingBidId
      ) {
        sending.value = false
        pendingBidId = null
      }
      if (message.type === 'lot_closed') {
        sending.value = false
        pendingBidId = null
      }
      bidError.value = ''
      return
    }
    if (message.type === 'error') {
      brokerError.value = reasonText(message.reason)
      if (message.reason === 'lot_closed') bidError.value = reasonText(message.reason)
      return
    }
    if (message.type === 'autobroker_set' || message.type === 'autobroker_removed') {
      brokerError.value = ''
    }
  }

  function send(message: ClientMessage) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !view.value.ready) return false
    socket.send(JSON.stringify(message))
    return true
  }

  function placeBid(amount: number) {
    if (!view.value.ready || sending.value || view.value.stage === 'closed') return
    const clientBidId = crypto.randomUUID()
    pendingBidId = clientBidId
    sending.value = true
    bidError.value = ''
    const sent = send({ type: 'place_bid', amount, clientBidId })
    if (!sent) {
      sending.value = false
      pendingBidId = null
      bidError.value = 'Нет соединения'
    }
  }

  function setAutobroker(maxAmount: number) {
    if (!view.value.ready || view.value.stage === 'closed') return
    brokerError.value = ''
    send({ type: 'set_autobroker', maxAmount })
  }

  function removeAutobroker() {
    if (!view.value.ready || view.value.stage === 'closed') return
    brokerError.value = ''
    send({ type: 'remove_autobroker' })
  }

  function switchParticipant(id: ParticipantId) {
    participantId.value = id
    interrupted = false
    everConnected = false
    banner.value = ''
    bidError.value = ''
    brokerError.value = ''
    sending.value = false
    pendingBidId = null
    status.value = 'восстанавливаем'
    view.value = { ...view.value, ready: false, autobroker: null }
    openSocket()
  }

  function onOffline() {
    interrupted = true
    status.value = 'восстанавливаем'
    socket?.close()
  }

  function onOnline() {
    openSocket()
  }

  onMounted(() => {
    openSocket()
    tickTimer = setInterval(() => {
      tick.value = Date.now()
    }, 1000)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
  })

  onUnmounted(() => {
    generation += 1
    clearRetry()
    socket?.close()
    socket = null
    if (tickTimer) clearInterval(tickTimer)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  })

  return {
    participantId,
    view,
    status,
    banner,
    sending,
    bidError,
    brokerError,
    you,
    minimum,
    leaderIsMe,
    timerLabel,
    placeBid,
    setAutobroker,
    removeAutobroker,
    switchParticipant,
  }
}
