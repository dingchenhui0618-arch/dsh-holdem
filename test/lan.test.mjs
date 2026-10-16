// Pure LAN helpers: room codes, discovery packets, seat takeover choice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCOVERY_MAGIC,
  LAN_VERSION,
  makeAnnouncement,
  makeRoomCode,
  normalizeRoomCode,
  parseAnnouncement,
  pickVictimSeat,
  prunePeers,
} from '../src/lan.js'

test('room codes are six digits and stay in range', () => {
  assert.equal(makeRoomCode(() => 0), '100000')
  assert.equal(makeRoomCode(() => 0.999999), '999999')
  for (let i = 0; i < 200; i++) {
    const code = makeRoomCode()
    assert.match(code, /^[1-9][0-9]{5}$/)
  }
})

test('room codes are normalized, not trusted as typed', () => {
  assert.equal(normalizeRoomCode(' 123 456 '), '123456')
  assert.equal(normalizeRoomCode('123456'), '123456')
  // A guest typing the wrong length must not be able to slip through.
  assert.equal(normalizeRoomCode('12345'), '')
  assert.equal(normalizeRoomCode('1234567'), '')
  assert.equal(normalizeRoomCode(''), '')
  assert.equal(normalizeRoomCode(null), '')
  assert.equal(normalizeRoomCode('abcdef'), '')
})

test('an announcement survives a round trip — without the room code', () => {
  const buf = makeAnnouncement({ id: 'room-7', name: '雷军的牌桌', code: '123456', port: 47811, players: 8, seats: 7, status: 'playing' })
  const info = parseAnnouncement(buf)
  assert.equal(info.id, 'room-7')
  assert.equal(info.name, '雷军的牌桌')
  assert.equal(info.port, 47811)
  // Anyone on the network can see the table exists, nobody learns the code.
  assert.equal(String(buf).indexOf('123456'), -1)
  assert.equal('code' in info, false)
  assert.equal(info.players, 8)
  assert.equal(info.status, 'playing')
})

test('foreign or malformed packets are ignored, never thrown', () => {
  assert.equal(parseAnnouncement(Buffer.from('not json at all')), null)
  assert.equal(parseAnnouncement(Buffer.from('null')), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: 'something-else', v: 1, id: 'x', port: 47811 }))), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: DISCOVERY_MAGIC, v: LAN_VERSION + 1, id: 'x', port: 47811 }))), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: DISCOVERY_MAGIC, v: LAN_VERSION, id: 'x', port: 0 }))), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: DISCOVERY_MAGIC, v: LAN_VERSION, id: 'x', port: 70000 }))), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: DISCOVERY_MAGIC, v: LAN_VERSION, port: 47811 }))), null)
  assert.equal(parseAnnouncement(Buffer.from(JSON.stringify({ magic: DISCOVERY_MAGIC, v: LAN_VERSION, id: 'x'.repeat(80), port: 47811 }))), null)
})

test('takeover never picks the human seat, and picks at random among the bots', () => {
  const seats = [1, 2, 3, 4, 5, 6, 7]
  assert.equal(pickVictimSeat(seats, () => 0), 1)
  assert.equal(pickVictimSeat(seats, () => 0.999999), 7)
  const seen = new Set()
  for (let i = 0; i < 300; i++) seen.add(pickVictimSeat(seats))
  assert.equal(seen.has(0), false)
  assert.ok(seen.size >= 5, 'spread across seats, got ' + seen.size)
  // A table with nothing left to take over yields no seat instead of seat 0.
  assert.equal(pickVictimSeat([], () => 0), null)
  assert.equal(pickVictimSeat([0], () => 0), null)
})

test('stale peers expire from the discovery list', () => {
  const now = 1_000_000
  const peers = [
    { name: 'a', port: 1, seenAt: now - 1000 },
    { name: 'b', port: 2, seenAt: now - 60_000 },
  ]
  const kept = prunePeers(peers, now)
  assert.deepEqual(kept.map((p) => p.name), ['a'])
  assert.deepEqual(prunePeers(null, now), [])
})
