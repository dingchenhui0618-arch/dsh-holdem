// End-to-end room test on ephemeral ports: a real guest joins a real table, and
// the only hole cards it can ever read are its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTable } from '../src/host.js'
import { GUEST_TTL_MS, createRoom, remoteAct, remoteInfo, remoteJoin, remoteLeave, remoteState } from '../src/lan.js'

function stubCtx() {
  return {
    effect(fn) { fn() },
    timeout() { return function () {} },
    get() { return undefined },
  }
}

function cardsOf(snap, seat) {
  const p = snap.players.find((row) => row.seat === seat)
  assert.ok(p, 'seat ' + seat + ' must exist')
  return p.cards.length
}

test('a guest joins by room code, plays the seat it took over, and gives it back', async () => {
  const table = createTable(stubCtx())
  table.start()
  const room = createRoom({ table, name: '测试牌桌', code: '424242', port: 0 })
  const port = await room.start()
  try {
    assert.ok(port > 0)
    const hello = await remoteInfo('127.0.0.1', port)
    assert.equal(hello.room.code, '424242')
    assert.equal(hello.room.players, 8)

    // Wrong code: refused, and no seat is handed out.
    await assert.rejects(() => remoteJoin('127.0.0.1', port, '111111', '闯入者'), (err) => err.status === 403)
    assert.equal(room.guestCount(), 0)

    const joined = await remoteJoin('127.0.0.1', port, '424242', '远程玩家')
    assert.ok(joined.ticket)
    assert.ok(joined.seat > 0, 'a guest never takes the human seat')
    assert.equal(room.guestCount(), 1)

    // The seat is now remote-controlled, so the engine stops betting it.
    const hostSeats = table.availableSeats()
    assert.equal(hostSeats.includes(joined.seat), false)
    const atSeat = table.snapshot(0).players.find((p) => p.seat === joined.seat)
    assert.equal(atSeat.kind, 'guest')
    assert.equal(atSeat.remote, true)

    // ... and gives it back when the guest leaves.
    await remoteLeave('127.0.0.1', port, joined.ticket)
    assert.equal(room.guestCount(), 0)
    assert.equal(table.availableSeats().includes(joined.seat), true)
    assert.equal(table.snapshot(0).players.find((p) => p.seat === joined.seat).kind, 'ai')
  } finally {
    await room.stop()
    table.dispose()
  }
})

test('a guest sees its own hole cards and nobody else sees them', async () => {
  const table = createTable(stubCtx())
  table.start()
  const room = createRoom({ table, name: '测试牌桌', code: '515151', port: 0 })
  await room.start()
  try {
    const port = room.port
    const joined = await remoteJoin('127.0.0.1', port, '515151', '远程玩家')
    const view = await remoteState('127.0.0.1', port, joined.ticket)
    assert.equal(view.seat, joined.seat)
    assert.equal(view.state.status, 'playing')
    // Own two cards, blind to everything else — including the host's own seat.
    assert.equal(cardsOf(view.state, joined.seat), 2)
    for (const p of view.state.players) {
      if (p.seat === joined.seat) continue
      assert.equal(p.cards.length, 0, 'guest must not see seat ' + p.seat)
    }
    const hostView = table.snapshot(0)
    assert.equal(cardsOf(hostView, 0), 2)
    assert.equal(cardsOf(hostView, joined.seat), 0, 'the host must not see the guest cards either')

    // No ticket, no state.
    await assert.rejects(() => remoteState('127.0.0.1', port, ''), (err) => err.status === 401)
    await assert.rejects(() => remoteAct('127.0.0.1', port, '', { type: 'fold' }), (err) => err.status === 401)
  } finally {
    await room.stop()
    table.dispose()
  }
})

test('a guest that stops polling hands its seat back to the bot', async () => {
  const table = createTable(stubCtx())
  table.start()
  let clock = 5_000_000
  const room = createRoom({ table, name: '测试牌桌', code: '626262', port: 0, now: () => clock })
  await room.start()
  try {
    const joined = room.join({ code: '626262', name: '掉线玩家' })
    assert.equal(room.guestCount(), 1)
    assert.equal(table.availableSeats().includes(joined.seat), false)
    // Silence for longer than the TTL: the seat goes back to its character.
    clock += GUEST_TTL_MS + 1
    assert.equal(room.guestCount(), 0)
    assert.equal(table.availableSeats().includes(joined.seat), true)
  } finally {
    await room.stop()
    table.dispose()
  }
})

test('closing a room releases every guest seat and frees the port', async () => {
  const table = createTable(stubCtx())
  table.start()
  const room = createRoom({ table, name: '测试牌桌', code: '737373', port: 0 })
  const port = await room.start()
  const a = room.join({ code: '737373' })
  const b = room.join({ code: '737373' })
  assert.equal(room.guestCount(), 2)
  await room.stop()
  // Two guests never share a seat, and both seats come back to the table.
  assert.notEqual(a.seat, b.seat)
  assert.equal(table.availableSeats().includes(a.seat), true)
  assert.equal(table.availableSeats().includes(b.seat), true)
  await assert.rejects(() => remoteInfo('127.0.0.1', port, 700), () => true)
  table.dispose()
})
