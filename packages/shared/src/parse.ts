import type { ClientMessage } from './types'

export type ParsedClientMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: 'bad_message' | 'unknown_participant' }

export function parseClientMessage(value: unknown): ParsedClientMessage {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'bad_message' }
  const body = value as Record<string, unknown>

  if (body.type === 'join') {
    if (body.participantId === 'a' || body.participantId === 'b') {
      return { ok: true, message: { type: 'join', participantId: body.participantId } }
    }
    return { ok: false, reason: 'unknown_participant' }
  }

  if (body.type === 'place_bid') {
    if (
      typeof body.clientBidId !== 'string' ||
      body.clientBidId.length === 0 ||
      typeof body.amount !== 'number'
    ) {
      return { ok: false, reason: 'bad_message' }
    }
    return {
      ok: true,
      message: { type: 'place_bid', amount: body.amount, clientBidId: body.clientBidId },
    }
  }

  if (body.type === 'set_autobroker') {
    if (typeof body.maxAmount !== 'number') return { ok: false, reason: 'bad_message' }
    return { ok: true, message: { type: 'set_autobroker', maxAmount: body.maxAmount } }
  }

  if (body.type === 'remove_autobroker') {
    return { ok: true, message: { type: 'remove_autobroker' } }
  }

  if (body.type === 'resync') return { ok: true, message: { type: 'resync' } }

  return { ok: false, reason: 'bad_message' }
}
