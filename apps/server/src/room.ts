import {
  apply,
  createAuction,
  parseClientMessage,
  toSnapshot,
  type ApplyResult,
  type ParticipantId,
} from '@auction/shared'
import { WebSocket } from 'ws'

type Connection = {
  socket: WebSocket
  participantId: ParticipantId | null
}

export function createRoom() {
  let auction = createAuction(Date.now())
  const connections = new Set<Connection>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function online(): ParticipantId[] {
    const ids = new Set<ParticipantId>()
    for (const connection of connections) {
      if (connection.participantId) ids.add(connection.participantId)
    }
    return (['a', 'b'] as const).filter((id) => ids.has(id))
  }

  function send(connection: Connection, message: unknown) {
    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message))
    }
  }

  function broadcast(message: unknown) {
    for (const connection of connections) {
      if (connection.participantId) send(connection, message)
    }
  }

  function sendToParticipant(participantId: ParticipantId, message: unknown) {
    for (const connection of connections) {
      if (connection.participantId === participantId) send(connection, message)
    }
  }

  function broadcastPresence() {
    broadcast({ type: 'presence', onlineParticipantIds: online() })
  }

  function armTimer() {
    if (timer) clearTimeout(timer)
    if (auction.stage === 'closed') {
      timer = undefined
      return
    }
    const delay = Math.max(0, auction.endsAt - Date.now())
    timer = setTimeout(closeIfDue, delay)
  }

  function closeIfDue() {
    timer = undefined
    const result = apply(auction, { type: 'close_if_due', now: Date.now() })
    auction = result.state
    for (const event of result.publicEvents) {
      broadcast(event)
      logPublic(event)
    }
    if (auction.stage !== 'closed') armTimer()
  }

  function publish(result: ApplyResult, actor: ParticipantId) {
    auction = result.state
    for (const event of result.publicEvents) {
      broadcast(event)
      logPublic(event)
    }
    for (const event of result.privateEvents) sendToParticipant(actor, event)
    if (result.rejection && !result.duplicate) {
      console.log(`reject ${actor} ${result.rejection.reason}`)
    }
    armTimer()
  }

  function connect(socket: WebSocket) {
    const connection: Connection = { socket, participantId: null }
    connections.add(connection)

    socket.on('message', (data) => {
      let payload: unknown
      try {
        payload = JSON.parse(data.toString())
      } catch {
        if (connection.participantId) send(connection, { type: 'error', reason: 'bad_message' })
        return
      }

      const parsed = parseClientMessage(payload)
      if (!parsed.ok) {
        if (!connection.participantId && parsed.reason !== 'unknown_participant') return
        send(connection, { type: 'error', reason: parsed.reason })
        return
      }

      const message = parsed.message
      if (message.type === 'join') {
        connection.participantId = message.participantId
        send(connection, toSnapshot(auction, message.participantId, online(), Date.now()))
        broadcastPresence()
        console.log(`join ${message.participantId}`)
        return
      }

      if (!connection.participantId) return

      if (message.type === 'resync') {
        send(connection, toSnapshot(auction, connection.participantId, online(), Date.now()))
        return
      }

      const now = Date.now()
      if (message.type === 'place_bid') {
        publish(
          apply(auction, {
            type: 'place_bid',
            participantId: connection.participantId,
            amount: message.amount,
            clientBidId: message.clientBidId,
            now,
            source: 'manual',
          }),
          connection.participantId,
        )
        return
      }

      if (message.type === 'set_autobroker') {
        publish(
          apply(auction, {
            type: 'set_autobroker',
            participantId: connection.participantId,
            maxAmount: message.maxAmount,
            now,
          }),
          connection.participantId,
        )
        return
      }

      publish(
        apply(auction, {
          type: 'remove_autobroker',
          participantId: connection.participantId,
          now,
        }),
        connection.participantId,
      )
    })

    socket.on('close', () => {
      connections.delete(connection)
      if (connection.participantId) broadcastPresence()
    })
  }

  armTimer()

  return {
    connect,
    endsAt: () => auction.endsAt,
  }
}

function logPublic(event: { type: string; seq?: number; bid?: { participantName: string; amount: number; source: string }; leader: unknown }) {
  if (event.type === 'bid_placed' && event.bid) {
    console.log(`bid #${event.seq} ${event.bid.participantName} ${event.bid.amount} ${event.bid.source}`)
    return
  }
  if (event.type === 'lot_closed') console.log(`closed #${event.seq}`, event.leader)
}
