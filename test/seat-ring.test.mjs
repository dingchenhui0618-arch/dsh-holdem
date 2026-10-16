// Seat-ring geometry. The risk this pins down: with eight seats the boxes must
// still not overlap on a realistic desktop table, and the ring must stay inside
// the felt for any roster size.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RING_X, RING_Y, seatDistance, seatIsTop, seatPos, seatXY } from '../src/seat-ring.js'

// .hk-table is aspect-ratio 2.15 / 1 and .hk-seat is a fixed 168px wide; a seat
// renders avatar + name + status, measured at ~118px tall in the browser.
const SEAT_W = 168
const SEAT_H = 118
const RATIO = 2.15

function overlaps(a, b) {
  return Math.abs(a.x - b.x) < SEAT_W && Math.abs(a.y - b.y) < SEAT_H
}

test('every seat lands inside the felt', () => {
  for (let count = 3; count <= 9; count++) {
    for (let seat = 0; seat < count; seat++) {
      const p = seatXY(seat, count)
      assert.ok(p.x >= 50 - RING_X - 1e-9 && p.x <= 50 + RING_X + 1e-9, 'seat ' + seat + '/' + count + ' x in range')
      assert.ok(p.y >= 50 - RING_Y - 1e-9 && p.y <= 50 + RING_Y + 1e-9, 'seat ' + seat + '/' + count + ' y in range')
    }
  }
})

function boxesAt(width, count) {
  const px = width / 100
  const py = width / RATIO / 100
  const boxes = []
  for (let seat = 0; seat < count; seat++) {
    const p = seatXY(seat, count)
    boxes.push({ x: p.x * px, y: p.y * py })
  }
  return boxes
}

function anyOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) return [i, j]
    }
  }
  return null
}

test('six to eight seats never collide on a desktop table', () => {
  // A normal conversation pane through to a wide window. Roster sizes above
  // eight are not shipped, and the ring gets tighter there (see the boundary
  // test below), so they are not asserted here.
  for (const width of [900, 1080, 1280]) {
    for (const count of [6, 7, 8]) {
      const hit = anyOverlap(boxesAt(width, count))
      assert.equal(hit, null, 'seats ' + (hit ? hit.join(' and ') : '') + ' overlap at width ' + width + ' with ' + count + ' seats')
    }
  }
})

test('the eight-seat ring clears its seat boxes down to a narrow pane', () => {
  // Smallest table width at which no two boxes overlap. Pinning the boundary
  // keeps the margin visible instead of hiding it behind a vague guarantee.
  let safe = Infinity
  for (let width = 600; width <= 1400; width += 10) {
    if (!anyOverlap(boxesAt(width, 8))) { safe = width; break }
  }
  assert.ok(safe <= 820, 'eight seats need a ' + safe + 'px wide table before the boxes clear each other')
})

test('the eight-handed ring keeps a real gap, not a touching one', () => {
  // Percent-space distance between neighbouring seats; the boxes must clear each
  // other by a margin rather than merely avoiding a mathematical overlap.
  const count = 8
  let min = Infinity
  for (let i = 0; i < count; i++) {
    min = Math.min(min, seatDistance(seatXY(i, count), seatXY((i + 1) % count, count)))
  }
  assert.ok(min > 5, 'neighbouring seats are only ' + min.toFixed(2) + '% apart in ring space')
})

test('seat 0 is the hero at bottom centre and seat 1 sits to its right', () => {
  for (const count of [6, 8]) {
    const hero = seatXY(0, count)
    assert.ok(Math.abs(hero.x - 50) < 1e-9, 'hero x is centred')
    assert.ok(hero.y > 50, 'hero sits below the middle')
    assert.equal(seatIsTop(0, count), false)
    assert.ok(seatXY(1, count).x > hero.x, 'seat 1 is to the right of the hero')
    assert.equal(seatIsTop(count / 2, count), true, 'the seat opposite the hero is at the top')
  }
})

test('seatPos keeps the percentage-style contract the client renders', () => {
  const style = seatPos(3, 8)
  assert.match(style.left, /^-?[0-9.]+%$/)
  assert.match(style.top, /^-?[0-9.]+%$/)
  assert.equal(style.transform, 'translate(-50%, -50%)')
})
