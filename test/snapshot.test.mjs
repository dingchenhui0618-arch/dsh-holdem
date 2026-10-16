import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTable } from '../src/host.js'

// Minimal ctx stub: timeout returns a disposer, effect just runs for its
// registration side effect, get() reports no llm so bots stay heuristic.
function stubCtx() {
  return {
    effect(fn) { fn() },
    timeout() { return function () {} },
    get() { return undefined },
  }
}

// Next seat clockwise on the drawn table (hero at bottom, seats increase right).
// Derived from the seat count: the ring must hold for any roster size, and the
// dealer is drawn at random, so a hard-coded six-seat map silently breaks the
// moment a seventh seat is dealt.
function clockwise(seat, count) {
  return (seat - 1 + count) % count
}

test('blinds sit clockwise from the dealer button', () => {
  const table = createTable(stubCtx())
  const snap = table.start()
  const n = snap.players.length
  const dealer = snap.players.find(p => p.isDealer)
  const sb = snap.players.filter(p => p.isSb)
  const bb = snap.players.filter(p => p.isBb)
  assert.equal(sb.length, 1)
  assert.equal(bb.length, 1)
  assert.equal(sb[0].seat, clockwise(dealer.seat, n))
  assert.equal(bb[0].seat, clockwise(sb[0].seat, n))
  assert.equal(new Set([dealer.seat, sb[0].seat, bb[0].seat]).size, 3)
})

test('preflop action starts clockwise from the big blind', () => {
  const table = createTable(stubCtx())
  const snap = table.start()
  const bb = snap.players.find(p => p.isBb)
  assert.equal(snap.toAct, clockwise(bb.seat, snap.players.length))
})
