// LAN play: one room per browser session that switches it on. The room serves a
// small JSON API on its own port (the DSH web server only listens on loopback,
// so guests cannot reach it) and announces itself over UDP broadcast so other
// installs on the same network can find it without typing an address.
//
// Pure helpers live at the top and are covered by test/lan.test.mjs; the socket
// plumbing below is covered by test/lan-room.test.mjs on ephemeral ports.
import dgram from 'node:dgram'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'

export const LAN_VERSION = 1
export const DISCOVERY_MAGIC = 'dsh-poker-night/lan'
export const DEFAULT_ROOM_PORT = 47811
export const DEFAULT_DISCOVERY_PORT = 47812
export const GUEST_TTL_MS = 20 * 1000
export const PEER_TTL_MS = 8 * 1000
export const MAX_GUESTS = 7
export const BROADCAST_INTERVAL_MS = 2000
export const TICKET_HEADER = 'x-poker-night-ticket'

// Six digits: short enough to read out loud, long enough that a stranger on the
// same network cannot guess it while the room is open.
export function makeRoomCode(random = Math.random) {
  return String(100000 + Math.floor(random() * 900000))
}

export function normalizeRoomCode(input) {
  const digits = String(input == null ? '' : input).replace(/[^0-9]/g, '')
  return digits.length === 6 ? digits : ''
}

// The broadcast deliberately carries no room code: anyone on the network may
// see that a table exists, but only someone told the code can join it.
export function makeAnnouncement(info) {
  return Buffer.from(JSON.stringify({
    magic: DISCOVERY_MAGIC,
    v: LAN_VERSION,
    id: String(info.id || '').slice(0, 64),
    name: String(info.name || '').slice(0, 48),
    port: info.port,
    players: info.players,
    seats: info.seats,
    status: String(info.status || ''),
  }))
}

// Anything that is not a well-formed announcement of this plugin and version is
// ignored, so unrelated UDP traffic on the port can never crash the listener.
export function parseAnnouncement(buf) {
  let msg
  try { msg = JSON.parse(String(buf)) } catch (e) { return null }
  if (!msg || typeof msg !== 'object') return null
  if (msg.magic !== DISCOVERY_MAGIC) return null
  if (msg.v !== LAN_VERSION) return null
  const port = Number(msg.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (port === DEFAULT_DISCOVERY_PORT) return null
  const id = String(msg.id || '')
  if (!id || id.length > 64) return null
  const players = Number(msg.players)
  return {
    id: id,
    name: String(msg.name || '未命名牌桌').slice(0, 48),
    port: port,
    players: Number.isInteger(players) ? players : 0,
    seats: Number.isInteger(Number(msg.seats)) ? Number(msg.seats) : 0,
    status: String(msg.status || '').slice(0, 24),
  }
}

// Which bot loses its seat to a joining player. Random on purpose: the joiner
// must not be able to pick a victim, and every character should get taken over
// across sessions.
export function pickVictimSeat(seats, random = Math.random) {
  const free = (seats || []).filter((s) => Number.isInteger(s) && s > 0)
  if (!free.length) return null
  const at = Math.floor(random() * free.length)
  return free[Math.min(Math.max(at, 0), free.length - 1)]
}

export function prunePeers(peers, now, ttl = PEER_TTL_MS) {
  return (peers || []).filter((p) => p && now - p.seenAt <= ttl)
}

export function localAddresses() {
  const out = []
  const all = networkInterfaces() || {}
  for (const name of Object.keys(all)) {
    for (const entry of all[name] || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue
      out.push({ iface: name, address: entry.address })
    }
  }
  return out
}

// ---------------------------------------------------------------- discovery

// A UDP socket bound to the discovery port. It both announces this room and
// collects announcements from other installs. Binding the fixed port can fail
// when a second instance runs on the same machine; that is not fatal, the caller
// keeps the socket on an ephemeral port and reports discovery as degraded.
export function createDiscovery(options) {
  const { port = DEFAULT_DISCOVERY_PORT, onPeer, log = function () {} } = options || {}
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let bound = false
  let bindError = null
  let selfId = options && options.selfId ? options.selfId : ''

  socket.on('message', function (buf, rinfo) {
    const info = parseAnnouncement(buf)
    if (!info) return
    if (selfId && info.id === selfId) return
    if (typeof onPeer === 'function') onPeer(info, rinfo)
  })
  socket.on('error', function (err) {
    bindError = err
    log('discovery socket error: ' + (err && err.message))
    try { socket.close() } catch (e) {}
  })

  return {
    bind() {
      return new Promise(function (resolve) {
        let settled = false
        const done = function (ok, err) {
          if (settled) return
          settled = true
          bound = ok
          bindError = err || null
          resolve(ok)
        }
        socket.bind(port, function () {
          try { socket.setBroadcast(true) } catch (e) {}
          done(true)
        })
        socket.once('error', function (err) { done(false, err) })
        setTimeout(function () { done(bound, bindError || new Error('timeout')) }, 1500).unref?.()
      })
    },
    announce(info) {
      if (!bound) return
      const payload = makeAnnouncement(info)
      const targets = [DEFAULT_DISCOVERY_PORT, port]
      const seen = new Set()
      for (const target of targets) {
        if (seen.has(target)) continue
        seen.add(target)
        socket.send(payload, 0, payload.length, target, '255.255.255.255', function () {})
        socket.send(payload, 0, payload.length, target, '127.0.0.1', function () {})
      }
    },
    get bound() { return bound },
    get error() { return bindError },
    close() {
      return new Promise(function (resolve) {
        try { socket.close(resolve) } catch (e) { resolve() }
      })
    },
  }
}

// --------------------------------------------------------------------- room

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  })
  res.end(data)
}

function readJson(req, limit = 16 * 1024) {
  return new Promise(function (resolve) {
    let size = 0
    const chunks = []
    req.on('data', function (chunk) {
      size += chunk.length
      if (size > limit) { req.destroy(); resolve(null); return }
      chunks.push(chunk)
    })
    req.on('end', function () {
      if (!chunks.length) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { resolve(null) }
    })
    req.on('error', function () { resolve(null) })
  })
}

// `table` is the session's game table. The room never owns game state: it only
// decides which seat a guest plays and asks the table for that seat's view.
export function createRoom(options) {
  const {
    table,
    name = 'poker night',
    code,
    port = DEFAULT_ROOM_PORT,
    random = Math.random,
    now = Date.now,
  } = options || {}

  const roomId = randomBytes(8).toString('hex')
  const guests = new Map()
  let server = null
  let listening = 0
  let failures = 0

  function pruneGuests() {
    const t = now()
    for (const [ticket, guest] of guests) {
      if (t - guest.lastSeen > GUEST_TTL_MS) {
        guests.delete(ticket)
        if (typeof table.releaseSeat === 'function') table.releaseSeat(guest.seat)
      }
    }
  }

  function activeGuests() {
    pruneGuests()
    return guests
  }

  function info() {
    return {
      id: roomId,
      name: name,
      code: code,
      port: listening || port,
      players: table.playerCount(),
      seats: table.availableSeats(),
      status: table.status(),
      handNo: table.handNo(),
      guests: activeGuests().size,
    }
  }

  function join(args) {
    pruneGuests()
    const given = normalizeRoomCode(args && args.code)
    if (!given || given !== code) {
      const err = new Error('房间号不对')
      err.status = 403
      throw err
    }
    if (guests.size >= MAX_GUESTS) {
      const err = new Error('桌上已经坐满了远程玩家')
      err.status = 409
      throw err
    }
    const seat = pickVictimSeat(table.availableSeats(), random)
    if (seat == null) {
      const err = new Error('没有可以顶替的座位')
      err.status = 409
      throw err
    }
    const ticket = randomBytes(24).toString('base64url')
    const guest = {
      ticket: ticket,
      seat: seat,
      name: String((args && args.name) || '远程玩家').slice(0, 24),
      lastSeen: now(),
      failures: ++failures,
    }
    table.claimSeat(seat)
    guests.set(ticket, guest)
    return { ticket: ticket, seat: seat, room: info() }
  }

  function guestFor(req) {
    const ticket = String((req.headers && req.headers[TICKET_HEADER]) || '')
    if (!ticket) return null
    const guest = activeGuests().get(ticket)
    if (!guest) return null
    guest.lastSeen = now()
    return guest
  }

  function leave(ticket) {
    const guest = guests.get(ticket)
    if (!guest) return false
    guests.delete(ticket)
    if (typeof table.releaseSeat === 'function') table.releaseSeat(guest.seat)
    return true
  }

  function handler(req, res) {
    const url = String(req.url || '/')
    const path = url.split('?')[0]
    if (req.method === 'GET' && path === '/lan/hello') {
      sendJson(res, 200, { room: info(), version: LAN_VERSION })
      return
    }
    if (req.method === 'POST' && path === '/lan/join') {
      readJson(req).then(function (body) {
        try {
          sendJson(res, 200, join(body || {}))
        } catch (err) {
          sendJson(res, err && err.status ? err.status : 400, { error: String((err && err.message) || 'join failed') })
        }
      })
      return
    }
    if (req.method === 'GET' && path === '/lan/state') {
      const guest = guestFor(req)
      if (!guest) { sendJson(res, 401, { error: 'ticket required' }); return }
      sendJson(res, 200, { seat: guest.seat, room: info(), state: table.snapshot(guest.seat) })
      return
    }
    if (req.method === 'POST' && path === '/lan/act') {
      const guest = guestFor(req)
      if (!guest) { sendJson(res, 401, { error: 'ticket required' }); return }
      readJson(req).then(function (body) {
        try {
          const snap = table.act(body || {}, guest.seat)
          sendJson(res, 200, { seat: guest.seat, state: snap })
        } catch (err) {
          sendJson(res, 400, { error: String((err && err.message) || 'action failed') })
        }
      })
      return
    }
    if (req.method === 'POST' && path === '/lan/leave') {
      const guest = guestFor(req)
      const ok = guest ? leave(guest.ticket) : false
      sendJson(res, 200, { left: ok })
      return
    }
    sendJson(res, 404, { error: 'unknown lan route' })
  }

  return {
    info: info,
    guestCount: function () { return activeGuests().size },
    join: join,
    leave: leave,
    pruneGuests: pruneGuests,
    start() {
      return new Promise(function (resolve, reject) {
        server = http.createServer(handler)
        server.on('error', reject)
        server.listen(port, '0.0.0.0', function () {
          listening = server.address().port
          resolve(listening)
        })
      })
    },
    stop() {
      return new Promise(function (resolve) {
        for (const guest of guests.values()) {
          if (typeof table.releaseSeat === 'function') table.releaseSeat(guest.seat)
        }
        guests.clear()
        if (!server) { resolve(); return }
        const s = server
        server = null
        try { s.close(resolve) } catch (e) { resolve() }
      })
    },
    get port() { return listening || port },
  }
}

// --------------------------------------------------------- remote room client

// Everything below runs inside the *local* plugin of the joining machine: it
// talks to the room over HTTP and hands the resulting snapshot to that machine's
// own client, so the client code needs no idea that a game is remote.
function baseUrl(host, port) {
  return 'http://' + String(host) + ':' + Number(port)
}

async function request(url, options, timeoutMs = 4000) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, options || {}))
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch (e) { body = null }
  if (!res.ok) {
    const err = new Error((body && body.error) || ('HTTP ' + res.status))
    err.status = res.status
    throw err
  }
  return body
}

export function remoteInfo(host, port, timeoutMs) {
  return request(baseUrl(host, port) + '/lan/hello', {}, timeoutMs)
}

export function remoteJoin(host, port, code, name, timeoutMs) {
  return request(baseUrl(host, port) + '/lan/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: normalizeRoomCode(code), name: name }),
  }, timeoutMs)
}

export function remoteState(host, port, ticket, timeoutMs) {
  return request(baseUrl(host, port) + '/lan/state', {
    headers: Object.assign({}, ticket ? { [TICKET_HEADER]: ticket } : {}),
  }, timeoutMs)
}

export function remoteAct(host, port, ticket, action, timeoutMs) {
  return request(baseUrl(host, port) + '/lan/act', {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, ticket ? { [TICKET_HEADER]: ticket } : {}),
    body: JSON.stringify(action || {}),
  }, timeoutMs)
}

export function remoteLeave(host, port, ticket, timeoutMs) {
  return request(baseUrl(host, port) + '/lan/leave', {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, ticket ? { [TICKET_HEADER]: ticket } : {}),
    body: '{}',
  }, timeoutMs)
}
