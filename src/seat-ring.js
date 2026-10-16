// Seat geometry for the felt, kept out of client.cjs so the ring can be tested
// without a browser. Seat 0 is the hero at the bottom, seat numbers increase to
// the right on the felt, and clockwise action runs the other way (see cw() in
// host.js). The ring is derived from the seat count, so adding or removing a
// character never leaves the layout behind.
export const RING_X = 44 // horizontal reach, in percent of the stage width
export const RING_Y = 50 // vertical reach, in percent of the stage height

export function seatAngle(seat, count) {
  const n = Math.max(count || 8, 3)
  return ((90 - (seat * 360) / n) * Math.PI) / 180
}

// Centre of a seat in percent of the stage, which is what the overlap checks
// measure. seatPos() wraps this into the React style object the client uses.
export function seatXY(seat, count) {
  const rad = seatAngle(seat, count)
  return {
    x: 50 + RING_X * Math.cos(rad),
    y: 50 + RING_Y * Math.sin(rad),
  }
}

export function seatPos(seat, count) {
  const p = seatXY(seat, count)
  return {
    left: p.x + '%',
    top: p.y + '%',
    transform: 'translate(-50%, -50%)',
  }
}

export function seatIsTop(seat, count) {
  return Math.sin(seatAngle(seat, count)) < 0
}

export function seatDistance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}
