import { describe, expect, it } from 'vitest'
import { apply, createAuction } from './apply'

const T0 = 1_700_000_000_000

describe('apply', () => {
  it('принимает первую ставку 10_000 и отклоняет 9_999 как below_min', () => {
    const state = createAuction(T0)

    const accepted = apply(state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'first',
      now: T0 + 1_000,
      source: 'manual',
    })
    expect(accepted.rejection).toBeUndefined()
    expect(accepted.state.leader).toEqual({ participantId: 'a', amount: 10_000 })
    expect(accepted.state.bids).toHaveLength(1)
    expect(state.bids).toHaveLength(0)
    expect(state.leader).toBeNull()

    const rejected = apply(state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 9_999,
      clientBidId: 'low',
      now: T0 + 1_000,
      source: 'manual',
    })
    expect(rejected.rejection?.reason).toBe('below_min')
    expect(rejected.state.bids).toHaveLength(0)
    expect(state.bids).toHaveLength(0)
  })

  it('не даёт лидеру перебить себя, отклоняет шаг минус рубль и принимает лидер + шаг', () => {
    const opened = apply(createAuction(T0), {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'open',
      now: T0 + 1_000,
      source: 'manual',
    })

    const self = apply(opened.state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_500,
      clientBidId: 'self',
      now: T0 + 2_000,
      source: 'manual',
    })
    expect(self.rejection?.reason).toBe('already_leader')
    expect(self.state.bids).toHaveLength(1)

    const under = apply(opened.state, {
      type: 'place_bid',
      participantId: 'b',
      amount: 10_499,
      clientBidId: 'under',
      now: T0 + 2_000,
      source: 'manual',
    })
    expect(under.rejection?.reason).toBe('below_min')
    expect(under.state.bids).toHaveLength(1)

    const accepted = apply(opened.state, {
      type: 'place_bid',
      participantId: 'b',
      amount: 10_500,
      clientBidId: 'ok',
      now: T0 + 2_000,
      source: 'manual',
    })
    expect(accepted.rejection).toBeUndefined()
    expect(accepted.state.leader).toEqual({ participantId: 'b', amount: 10_500 })
    expect(accepted.state.bids).toHaveLength(2)
    expect(accepted.state.endsAt).toBe(opened.state.endsAt)
  })

  it('повтор того же clientBidId оставляет одну ставку', () => {
    const first = apply(createAuction(T0), {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'same',
      now: T0 + 1_000,
      source: 'manual',
    })
    const second = apply(first.state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 11_000,
      clientBidId: 'same',
      now: T0 + 2_000,
      source: 'manual',
    })

    expect(second.duplicate).toBe(true)
    expect(second.state).toBe(first.state)
    expect(second.state.bids).toHaveLength(1)
    expect(second.state.seq).toBe(first.state.seq)
    expect(second.publicEvents).toHaveLength(0)
  })

  it('включение брокера отстающим с достаточным потолком сразу ставит следующую цену', () => {
    const leading = apply(createAuction(T0), {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'open',
      now: T0 + 1_000,
      source: 'manual',
    })
    const armed = apply(leading.state, {
      type: 'set_autobroker',
      participantId: 'b',
      maxAmount: 12_000,
      now: T0 + 2_000,
    })

    expect(armed.rejection).toBeUndefined()
    expect(armed.state.bids).toHaveLength(2)
    expect(armed.state.leader).toEqual({ participantId: 'b', amount: 10_500 })
    expect(armed.state.bids[0]).toMatchObject({
      participantId: 'b',
      amount: 10_500,
      source: 'autobroker',
    })
    expect(armed.state.autobrokers.b?.maxAmount).toBe(12_000)
  })

  it('два брокера останавливаются на меньшем потолке, лидер — у кого потолок выше', () => {
    const higher = apply(createAuction(T0), {
      type: 'set_autobroker',
      participantId: 'a',
      maxAmount: 20_000,
      now: T0 + 1_000,
    })
    const finished = apply(higher.state, {
      type: 'set_autobroker',
      participantId: 'b',
      maxAmount: 15_000,
      now: T0 + 2_000,
    })

    expect(finished.state.leader).toEqual({ participantId: 'a', amount: 15_000 })
    expect(Math.max(...finished.state.bids.map((bid) => bid.amount))).toBe(15_000)
    expect(finished.state.bids.every((bid) => bid.amount <= 15_000)).toBe(true)
    expect(finished.state.autobrokers.a?.maxAmount).toBe(20_000)
    expect(finished.state.autobrokers.b?.maxAmount).toBe(15_000)
  })

  it('ставка за 10 секунд до конца сдвигает endsAt на 30 секунд вперёд от текущего времени', () => {
    const state = createAuction(T0)
    const now = state.endsAt - 10_000
    const next = apply(state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'snipe',
      now,
      source: 'manual',
    })

    expect(next.rejection).toBeUndefined()
    expect(next.state.endsAt).toBe(now + 30_000)
  })

  it('команда после endsAt закрывает лот и возвращает lot_closed', () => {
    const state = createAuction(T0)
    const next = apply(state, {
      type: 'place_bid',
      participantId: 'a',
      amount: 10_000,
      clientBidId: 'late',
      now: state.endsAt,
      source: 'manual',
    })

    expect(next.rejection?.reason).toBe('lot_closed')
    expect(next.state.stage).toBe('closed')
    expect(next.state.bids).toHaveLength(0)
    expect(next.publicEvents.map((event) => event.type)).toEqual(['lot_closed'])
  })
})
