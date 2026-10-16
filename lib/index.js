// src/host.js
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";

// src/cards.js
var RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
var SUITS = ["s", "h", "d", "c"];
var HAND_NAMES = ["\u9AD8\u724C", "\u4E00\u5BF9", "\u4E24\u5BF9", "\u4E09\u6761", "\u987A\u5B50", "\u540C\u82B1", "\u846B\u82A6", "\u56DB\u6761", "\u540C\u82B1\u987A", "\u7687\u5BB6\u540C\u82B1\u987A"];
var RANK_TXT = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "T", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" };
var SUIT_TXT = { s: "s", h: "h", d: "d", c: "c" };
function cardTxt(c) {
  if (!c) return "?";
  return (RANK_TXT[c.r] || c.r) + (SUIT_TXT[c.s] || c.s);
}
function makeDeck() {
  const deck = [];
  for (let s = 0; s < SUITS.length; s++) {
    for (let r = 0; r < RANKS.length; r++) deck.push({ r: RANKS[r], s: SUITS[s] });
  }
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck;
}
function eval5(cards) {
  const ranks = cards.map(function(c) {
    return c.r;
  }).sort(function(a, b) {
    return b - a;
  });
  const flush = cards.every(function(c) {
    return c.s === cards[0].s;
  });
  const uniq = [];
  for (let i = 0; i < ranks.length; i++) {
    if (uniq[uniq.length - 1] !== ranks[i]) uniq.push(ranks[i]);
  }
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) straightHigh = 5;
  }
  const counts = {};
  for (let i = 0; i < ranks.length; i++) counts[ranks[i]] = (counts[ranks[i]] || 0) + 1;
  const groups = Object.keys(counts).map(Number).sort(function(a, b) {
    const d = counts[b] - counts[a];
    return d !== 0 ? d : b - a;
  });
  let cat = 0;
  let kick = ranks;
  if (straightHigh && flush) {
    cat = straightHigh === 14 ? 9 : 8;
    kick = [straightHigh];
  } else if (counts[groups[0]] === 4) {
    cat = 7;
    kick = groups;
  } else if (counts[groups[0]] === 3 && counts[groups[1]] === 2) {
    cat = 6;
    kick = groups;
  } else if (flush) {
    cat = 5;
    kick = ranks;
  } else if (straightHigh) {
    cat = 4;
    kick = [straightHigh];
  } else if (counts[groups[0]] === 3) {
    cat = 3;
    kick = groups;
  } else if (counts[groups[0]] === 2 && counts[groups[1]] === 2) {
    cat = 2;
    kick = groups;
  } else if (counts[groups[0]] === 2) {
    cat = 1;
    kick = groups;
  }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 16 + (kick[i] || 0);
  const name2 = cat === 9 ? HAND_NAMES[9] : HAND_NAMES[cat];
  return { cat, kick, score, name: name2 };
}
function combos5(cards) {
  const out = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
        }
      }
    }
  }
  return out;
}
function evalBest(cards) {
  if (!cards || cards.length < 5) return { cat: -1, score: -1, name: "\u2014", kick: [] };
  if (cards.length === 5) return eval5(cards);
  const list = combos5(cards);
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const ev = eval5(list[i]);
    if (!best || ev.score > best.score) best = ev;
  }
  return best;
}
function preflopScore(cards) {
  const a = cards[0].r >= cards[1].r ? cards[0] : cards[1];
  const b = cards[0].r >= cards[1].r ? cards[1] : cards[0];
  if (a.r === b.r) return Math.min(0.96, 0.46 + a.r / 28);
  const gap = a.r - b.r;
  let s = (a.r + b.r) / 42;
  if (a.s === b.s) s += 0.08;
  if (gap === 1) s += 0.09;
  else if (gap === 2) s += 0.04;
  else s -= gap * 0.016;
  if (a.r >= 13 && b.r >= 10) s += 0.08;
  return Math.max(0.06, Math.min(0.9, s));
}
function strength(hole, board) {
  if (!board || board.length === 0) return preflopScore(hole);
  const ev = evalBest(hole.concat(board));
  const boardEv = board.length >= 5 ? evalBest(board.slice()) : null;
  let s = 0.12 + ev.cat * 0.09;
  if (boardEv && ev.score <= boardEv.score) s *= 0.55;
  if (ev.cat >= 4) s += 0.12;
  return Math.max(0.06, Math.min(0.98, s));
}

// src/bets.js
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function raiseCeiling(opts) {
  const pot = Number(opts.pot) || 0;
  const currentBet = Number(opts.currentBet) || 0;
  const bb = Number(opts.bb) || 0;
  const minR = Number(opts.minR) || 0;
  const maxR = Number(opts.maxR) || 0;
  if (maxR <= 0) return 0;
  const cap = currentBet + Math.max(3 * Math.max(pot, bb), 4 * bb);
  return Math.max(minR, Math.min(maxR, Math.floor(cap)));
}
function clampRaise(amount, opts) {
  const minR = Number(opts.minR) || 0;
  const maxR = Number(opts.maxR) || 0;
  if (maxR <= 0) return 0;
  const v = typeof amount === "number" && isFinite(amount) ? Math.floor(amount) : 0;
  if (!(v > 0)) return Math.max(0, Math.min(minR, maxR));
  return clamp(v, minR, raiseCeiling(opts));
}

// src/table-rules.js
var MAX_REBUYS = 3;
function rebuyDecision(player, opts) {
  const max = opts && typeof opts.max === "number" ? opts.max : MAX_REBUYS;
  const start = opts && typeof opts.start === "number" ? opts.start : 0;
  const used = player && typeof player.rebuys === "number" ? player.rebuys : 0;
  if (!player || player.out) return { action: "out" };
  if (player.stack > 0) return { action: "keep" };
  if (used < max) return { action: "rebuy", rebuys: used + 1, stack: start };
  return { action: "out" };
}
function blindSeats(seatCount, active, dealer) {
  const seated = active.slice().sort(function(a, b) {
    return a - b;
  });
  if (seated.length < 2) return null;
  if (seated.length === 2) {
    const button = seated.indexOf(dealer) !== -1 ? dealer : seated[0];
    return { sb: button, bb: button === seated[0] ? seated[1] : seated[0] };
  }
  const next = function(from) {
    for (let i = 1; i <= seatCount; i++) {
      const s = (from - i % seatCount + seatCount) % seatCount;
      if (seated.indexOf(s) !== -1) return s;
    }
    return null;
  };
  const sb = next(dealer);
  return { sb, bb: next(sb) };
}

// src/pots.js
function makePots(players) {
  const levels = [];
  for (let i = 0; i < players.length; i++) {
    const c = players[i].committed;
    if (c > 0 && levels.indexOf(c) === -1) levels.push(c);
  }
  levels.sort(function(a, b) {
    return a - b;
  });
  const pots = [];
  let prev = 0;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    let amount = 0;
    const eligible = [];
    for (let j = 0; j < players.length; j++) {
      const p = players[j];
      if (p.committed > prev) amount += Math.min(p.committed, level) - prev;
      if (!p.folded && p.committed >= level) eligible.push(p);
    }
    if (amount > 0 && eligible.length) pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

// src/talk.js
var TALK_MAX_LENGTH = 16;
var NEUTRAL_TALKS = {
  blind: ["\u6309\u89C4\u77E9\u6765\u3002", "\u5148\u4EA4\u4E2A\u76F2\u6CE8\u3002", "\u8F6E\u5230\u6211\u4E86\u3002", "\u6CA1\u4EC0\u4E48\u597D\u8BF4\u7684\u3002"],
  fold: ["\u8FD9\u624B\u5148\u4E0D\u73A9\u3002", "\u6211\u5148\u8BA9\u4E00\u624B\u3002", "\u6CA1\u4EC0\u4E48\u597D\u8BF4\u7684\u3002", "\u5148\u770B\u4F60\u4EEC\u4E89\u3002"],
  check: ["\u5148\u770B\u770B\u3002", "\u4E0D\u6025\u3002", "\u6CA1\u4EC0\u4E48\u597D\u8BF4\u7684\u3002", "\u6211\u5148\u8FC7\u3002"],
  call: ["\u5148\u8DDF\u7740\u770B\u3002", "\u8FD9\u70B9\u4EE3\u4EF7\u53EF\u4EE5\u3002", "\u518D\u770B\u4E00\u5F20\u3002", "\u6CA1\u4EC0\u4E48\u597D\u8BF4\u7684\u3002"],
  raise: ["\u7ED9\u70B9\u538B\u529B\u3002", "\u7EE7\u7EED\u3002", "\u6211\u6765\u52A0\u901F\u3002", "\u5148\u628A\u6C60\u5B50\u505A\u5927\u3002"]
};
var BLUFF_TALKS = {
  blind: ["\u8FD9\u70B9\u76F2\u6CE8\u4E0D\u7B97\u4EC0\u4E48\u3002", "\u5148\u7ED9\u4F60\u4EEC\u4E00\u70B9\u673A\u4F1A\u3002", "\u522B\u628A\u76F2\u6CE8\u5F53\u4FE1\u53F7\u3002"],
  fold: ["\u5DEE\u4E00\u70B9\u5C31\u8DDF\u4E86\u3002", "\u6211\u53EA\u662F\u6362\u4E2A\u8282\u594F\u3002", "\u522B\u4EE5\u4E3A\u6211\u6015\u4E86\u3002"],
  check: ["\u6211\u7B49\u4F60\u4EEC\u72AF\u9519\u3002", "\u4F60\u4EEC\u53EF\u4EE5\u7EE7\u7EED\u731C\u3002", "\u6211\u5F88\u6709\u8010\u5FC3\u3002"],
  call: ["\u6211\u53EA\u662F\u966A\u4F60\u4EEC\u73A9\u3002", "\u8FD9\u70B9\u538B\u529B\u4E0D\u591F\u3002", "\u8FD8\u6CA1\u5230\u8BA4\u771F\u65F6\u5019\u3002"],
  raise: ["\u8FD9\u70B9\u538B\u529B\u4E0D\u591F\u3002", "\u522B\u628A\u6211\u5F53\u7A7A\u6C14\u3002", "\u6211\u53EF\u4E0D\u662F\u5728\u8BD5\u63A2\u3002", "\u8FD9\u5C40\u6211\u8BF4\u4E86\u7B97\u3002"]
};
var FORBIDDEN_TALK = /(底牌|手牌|洞牌|对子|同花|顺子|葫芦|四条|皇家|听牌|成牌|牌力|胜率|赔率|范围|range|odds|equity|[♠♥♦♣]|黑桃|红心|红桃|方块|梅花|[AKQJT2-9][shdc])/i;
function actionKey(action) {
  if (action === "bet" || action === "allin") return "raise";
  return NEUTRAL_TALKS[action] ? action : "check";
}
function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}
function sanitizeTalk(raw) {
  if (!raw || typeof raw !== "string") return "";
  const talk = raw.replace(/\s+/g, "").trim();
  if (!talk) return "";
  if (/[A-Za-z]{3,}/.test(talk)) return "";
  if (FORBIDDEN_TALK.test(talk)) return "";
  return Array.from(talk).slice(0, TALK_MAX_LENGTH).join("");
}
function fallbackTalk(player, action, random = Math.random, recent = []) {
  const key = actionKey(action);
  const useBluff = random() < clamp01(player && player.bluff);
  const pool = useBluff ? BLUFF_TALKS[key] : NEUTRAL_TALKS[key];
  const previous = Array.isArray(recent) ? recent[recent.length - 1] : "";
  const choices = pool.filter(function(line2) {
    return line2 !== previous;
  });
  const list = choices.length ? choices : pool;
  const line = list[Math.floor(random() * list.length)] || NEUTRAL_TALKS.check[0];
  return sanitizeTalk(line) || "\u6CA1\u4EC0\u4E48\u597D\u8BF4\u7684\u3002";
}

// src/avatars.js
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var PLAYER_IDS = ["hero", "altman", "dario", "musk", "liang", "jensen", "leijun", "yiming"];
var AGENT_IDS = ["altman", "dario", "musk", "liang", "jensen", "leijun", "yiming"];
var MAX_AVATAR_BYTES = 2 * 1024 * 1024;
var BUNDLED_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
function isPlayerId(id) {
  return PLAYER_IDS.indexOf(id) !== -1;
}
function avatarDataDir() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  const dir = join(home, "dsh-poker-night", "avatars");
  const legacy = join(home, "dsh-holdem", "avatars");
  if (!existsSync(dir) && existsSync(legacy)) {
    try {
      mkdirSync(dir, { recursive: true });
      cpSync(legacy, dir, { recursive: true });
    } catch (e) {
      return legacy;
    }
  }
  return dir;
}
function bundledAvatarDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromSrc = join(here, "..", "assets", "avatars");
  if (existsSync(fromSrc)) return fromSrc;
  return join(here, "avatars");
}
function sniffMime(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "image/webp";
  return "";
}
function decodeAvatar(args) {
  args = args || {};
  let bytes = args.bytes;
  if (typeof args.image === "string") {
    const raw = args.image.replace(/\s/g, "");
    const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(raw);
    if (m) bytes = Buffer.from(m[2], "base64");
    else bytes = Buffer.from(raw, "base64");
  }
  if (typeof bytes === "string") bytes = Buffer.from(bytes, "base64");
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null;
  const mime = sniffMime(bytes);
  if (!mime) return null;
  return { bytes, mime };
}
function readOverride(dir, id) {
  if (!isPlayerId(id)) return null;
  const file = join(dir, id);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const mime = sniffMime(bytes);
  if (!mime) return null;
  let rev = 0;
  try {
    rev = Math.floor(statSync(file).mtimeMs);
  } catch (e) {
    rev = Date.now();
  }
  return { bytes, mime, rev };
}
function loadOverrides(dir) {
  const out = {};
  if (!dir || !existsSync(dir)) return out;
  for (let i = 0; i < PLAYER_IDS.length; i++) {
    const rec = readOverride(dir, PLAYER_IDS[i]);
    if (rec) out[PLAYER_IDS[i]] = rec;
  }
  return out;
}
function writeOverride(dir, id, rec) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, id), rec.bytes);
  const st = statSync(join(dir, id));
  return { bytes: rec.bytes, mime: rec.mime, rev: Math.floor(st.mtimeMs) };
}
function removeOverride(dir, id) {
  if (!isPlayerId(id)) return;
  const file = join(dir, id);
  if (existsSync(file)) unlinkSync(file);
}
function readBundled(dir, id) {
  if (id === "hero" || !isPlayerId(id) || !dir || !existsSync(dir)) return null;
  for (let i = 0; i < BUNDLED_EXTS.length; i++) {
    const file = join(dir, id + BUNDLED_EXTS[i]);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const mime = sniffMime(bytes);
    if (!mime) continue;
    let rev = 0;
    try {
      rev = Math.floor(statSync(file).mtimeMs);
    } catch (e) {
      rev = Date.now();
    }
    return { bytes, mime, rev };
  }
  return null;
}
function loadBundled(dir) {
  const out = {};
  const root = dir || bundledAvatarDir();
  if (!root || !existsSync(root)) return out;
  for (let i = 0; i < AGENT_IDS.length; i++) {
    const rec = readBundled(root, AGENT_IDS[i]);
    if (rec) out[AGENT_IDS[i]] = rec;
  }
  return out;
}
function avatarSrc(id, rev, mediaToken) {
  return "/dsh-poker-night/avatar/" + id + "?v=" + rev + (mediaToken ? "&t=" + encodeURIComponent(mediaToken) : "");
}
function avatarView(id, overrides, bundled, mediaToken) {
  const rec = overrides && overrides[id];
  if (rec) {
    return {
      kind: "override",
      seed: id,
      src: avatarSrc(id, rec.rev, mediaToken)
    };
  }
  const pack = bundled && bundled[id];
  if (pack) {
    return {
      kind: "default",
      seed: id,
      src: avatarSrc(id, pack.rev, mediaToken)
    };
  }
  return { kind: "identicon", seed: id, src: "" };
}

// src/lan.js
import dgram from "node:dgram";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
var LAN_VERSION = 1;
var DISCOVERY_MAGIC = "dsh-poker-night/lan";
var DEFAULT_ROOM_PORT = 47811;
var DEFAULT_DISCOVERY_PORT = 47812;
var GUEST_TTL_MS = 20 * 1e3;
var PEER_TTL_MS = 8 * 1e3;
var MAX_GUESTS = 7;
var BROADCAST_INTERVAL_MS = 2e3;
var TICKET_HEADER = "x-poker-night-ticket";
function makeRoomCode(random = Math.random) {
  return String(1e5 + Math.floor(random() * 9e5));
}
function normalizeRoomCode(input) {
  const digits = String(input == null ? "" : input).replace(/[^0-9]/g, "");
  return digits.length === 6 ? digits : "";
}
function makeAnnouncement(info) {
  return Buffer.from(JSON.stringify({
    magic: DISCOVERY_MAGIC,
    v: LAN_VERSION,
    id: String(info.id || "").slice(0, 64),
    name: String(info.name || "").slice(0, 48),
    port: info.port,
    players: info.players,
    seats: info.seats,
    status: String(info.status || "")
  }));
}
function parseAnnouncement(buf) {
  let msg;
  try {
    msg = JSON.parse(String(buf));
  } catch (e) {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  if (msg.magic !== DISCOVERY_MAGIC) return null;
  if (msg.v !== LAN_VERSION) return null;
  const port = Number(msg.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (port === DEFAULT_DISCOVERY_PORT) return null;
  const id = String(msg.id || "");
  if (!id || id.length > 64) return null;
  const players = Number(msg.players);
  return {
    id,
    name: String(msg.name || "\u672A\u547D\u540D\u724C\u684C").slice(0, 48),
    port,
    players: Number.isInteger(players) ? players : 0,
    seats: Number.isInteger(Number(msg.seats)) ? Number(msg.seats) : 0,
    status: String(msg.status || "").slice(0, 24)
  };
}
function pickVictimSeat(seats, random = Math.random) {
  const free = (seats || []).filter((s) => Number.isInteger(s) && s > 0);
  if (!free.length) return null;
  const at = Math.floor(random() * free.length);
  return free[Math.min(Math.max(at, 0), free.length - 1)];
}
function prunePeers(peers, now, ttl = PEER_TTL_MS) {
  return (peers || []).filter((p) => p && now - p.seenAt <= ttl);
}
function localAddresses() {
  const out = [];
  const all = networkInterfaces() || {};
  for (const name2 of Object.keys(all)) {
    for (const entry of all[name2] || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) continue;
      out.push({ iface: name2, address: entry.address });
    }
  }
  return out;
}
function createDiscovery(options) {
  const { port = DEFAULT_DISCOVERY_PORT, onPeer, log = function() {
  } } = options || {};
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let bound = false;
  let bindError = null;
  let selfId = options && options.selfId ? options.selfId : "";
  socket.on("message", function(buf, rinfo) {
    const info = parseAnnouncement(buf);
    if (!info) return;
    if (selfId && info.id === selfId) return;
    if (typeof onPeer === "function") onPeer(info, rinfo);
  });
  socket.on("error", function(err) {
    bindError = err;
    log("discovery socket error: " + (err && err.message));
    try {
      socket.close();
    } catch (e) {
    }
  });
  return {
    bind() {
      return new Promise(function(resolve) {
        let settled = false;
        const done = function(ok, err) {
          if (settled) return;
          settled = true;
          bound = ok;
          bindError = err || null;
          resolve(ok);
        };
        socket.bind(port, function() {
          try {
            socket.setBroadcast(true);
          } catch (e) {
          }
          done(true);
        });
        socket.once("error", function(err) {
          done(false, err);
        });
        setTimeout(function() {
          done(bound, bindError || new Error("timeout"));
        }, 1500).unref?.();
      });
    },
    announce(info) {
      if (!bound) return;
      const payload = makeAnnouncement(info);
      const targets = [DEFAULT_DISCOVERY_PORT, port];
      const seen = /* @__PURE__ */ new Set();
      for (const target of targets) {
        if (seen.has(target)) continue;
        seen.add(target);
        socket.send(payload, 0, payload.length, target, "255.255.255.255", function() {
        });
        socket.send(payload, 0, payload.length, target, "127.0.0.1", function() {
        });
      }
    },
    get bound() {
      return bound;
    },
    get error() {
      return bindError;
    },
    close() {
      return new Promise(function(resolve) {
        try {
          socket.close(resolve);
        } catch (e) {
          resolve();
        }
      });
    }
  };
}
function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
    "cache-control": "no-store"
  });
  res.end(data);
}
function readJson(req, limit = 16 * 1024) {
  return new Promise(function(resolve) {
    let size = 0;
    const chunks = [];
    req.on("data", function(chunk) {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function() {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        resolve(null);
      }
    });
    req.on("error", function() {
      resolve(null);
    });
  });
}
function createRoom(options) {
  const {
    table,
    name: name2 = "poker night",
    code,
    port = DEFAULT_ROOM_PORT,
    random = Math.random,
    now = Date.now
  } = options || {};
  const roomId = randomBytes(8).toString("hex");
  const guests = /* @__PURE__ */ new Map();
  let server = null;
  let listening = 0;
  let failures = 0;
  function pruneGuests() {
    const t = now();
    for (const [ticket, guest] of guests) {
      if (t - guest.lastSeen > GUEST_TTL_MS) {
        guests.delete(ticket);
        if (typeof table.releaseSeat === "function") table.releaseSeat(guest.seat);
      }
    }
  }
  function activeGuests() {
    pruneGuests();
    return guests;
  }
  function info() {
    return {
      id: roomId,
      name: name2,
      code,
      port: listening || port,
      players: table.playerCount(),
      seats: table.availableSeats(),
      status: table.status(),
      handNo: table.handNo(),
      guests: activeGuests().size
    };
  }
  function join2(args) {
    pruneGuests();
    const given = normalizeRoomCode(args && args.code);
    if (!given || given !== code) {
      const err = new Error("\u623F\u95F4\u53F7\u4E0D\u5BF9");
      err.status = 403;
      throw err;
    }
    if (guests.size >= MAX_GUESTS) {
      const err = new Error("\u684C\u4E0A\u5DF2\u7ECF\u5750\u6EE1\u4E86\u8FDC\u7A0B\u73A9\u5BB6");
      err.status = 409;
      throw err;
    }
    const seat = pickVictimSeat(table.availableSeats(), random);
    if (seat == null) {
      const err = new Error("\u6CA1\u6709\u53EF\u4EE5\u9876\u66FF\u7684\u5EA7\u4F4D");
      err.status = 409;
      throw err;
    }
    const ticket = randomBytes(24).toString("base64url");
    const guest = {
      ticket,
      seat,
      name: String(args && args.name || "\u8FDC\u7A0B\u73A9\u5BB6").slice(0, 24),
      lastSeen: now(),
      failures: ++failures
    };
    table.claimSeat(seat);
    guests.set(ticket, guest);
    return { ticket, seat, room: info() };
  }
  function guestFor(req) {
    const ticket = String(req.headers && req.headers[TICKET_HEADER] || "");
    if (!ticket) return null;
    const guest = activeGuests().get(ticket);
    if (!guest) return null;
    guest.lastSeen = now();
    return guest;
  }
  function leave(ticket) {
    const guest = guests.get(ticket);
    if (!guest) return false;
    guests.delete(ticket);
    if (typeof table.releaseSeat === "function") table.releaseSeat(guest.seat);
    return true;
  }
  function handler(req, res) {
    const url = String(req.url || "/");
    const path = url.split("?")[0];
    if (req.method === "GET" && path === "/lan/hello") {
      sendJson(res, 200, { room: info(), version: LAN_VERSION });
      return;
    }
    if (req.method === "POST" && path === "/lan/join") {
      readJson(req).then(function(body) {
        try {
          sendJson(res, 200, join2(body || {}));
        } catch (err) {
          sendJson(res, err && err.status ? err.status : 400, { error: String(err && err.message || "join failed") });
        }
      });
      return;
    }
    if (req.method === "GET" && path === "/lan/state") {
      const guest = guestFor(req);
      if (!guest) {
        sendJson(res, 401, { error: "ticket required" });
        return;
      }
      sendJson(res, 200, { seat: guest.seat, room: info(), state: table.snapshot(guest.seat) });
      return;
    }
    if (req.method === "POST" && path === "/lan/act") {
      const guest = guestFor(req);
      if (!guest) {
        sendJson(res, 401, { error: "ticket required" });
        return;
      }
      readJson(req).then(function(body) {
        try {
          const snap = table.act(body || {}, guest.seat);
          sendJson(res, 200, { seat: guest.seat, state: snap });
        } catch (err) {
          sendJson(res, 400, { error: String(err && err.message || "action failed") });
        }
      });
      return;
    }
    if (req.method === "POST" && path === "/lan/leave") {
      const guest = guestFor(req);
      const ok = guest ? leave(guest.ticket) : false;
      sendJson(res, 200, { left: ok });
      return;
    }
    sendJson(res, 404, { error: "unknown lan route" });
  }
  return {
    info,
    guestCount: function() {
      return activeGuests().size;
    },
    join: join2,
    leave,
    pruneGuests,
    start() {
      return new Promise(function(resolve, reject) {
        server = http.createServer(handler);
        server.on("error", reject);
        server.listen(port, "0.0.0.0", function() {
          listening = server.address().port;
          resolve(listening);
        });
      });
    },
    stop() {
      return new Promise(function(resolve) {
        for (const guest of guests.values()) {
          if (typeof table.releaseSeat === "function") table.releaseSeat(guest.seat);
        }
        guests.clear();
        if (!server) {
          resolve();
          return;
        }
        const s = server;
        server = null;
        try {
          s.close(resolve);
        } catch (e) {
          resolve();
        }
      });
    },
    get port() {
      return listening || port;
    }
  };
}
function baseUrl(host, port) {
  return "http://" + String(host) + ":" + Number(port);
}
async function request(url, options, timeoutMs = 4e3) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, options || {}));
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body && body.error || "HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return body;
}
function remoteJoin(host, port, code, name2, timeoutMs) {
  return request(baseUrl(host, port) + "/lan/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalizeRoomCode(code), name: name2 })
  }, timeoutMs);
}
function remoteState(host, port, ticket, timeoutMs) {
  return request(baseUrl(host, port) + "/lan/state", {
    headers: Object.assign({}, ticket ? { [TICKET_HEADER]: ticket } : {})
  }, timeoutMs);
}
function remoteAct(host, port, ticket, action, timeoutMs) {
  return request(baseUrl(host, port) + "/lan/act", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, ticket ? { [TICKET_HEADER]: ticket } : {}),
    body: JSON.stringify(action || {})
  }, timeoutMs);
}
function remoteLeave(host, port, ticket, timeoutMs) {
  return request(baseUrl(host, port) + "/lan/leave", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, ticket ? { [TICKET_HEADER]: ticket } : {}),
    body: "{}"
  }, timeoutMs);
}

// src/host.js
var START_STACK = 2e6;
var SB = 1e4;
var BB = 2e4;
var MAX_REQUEST_BYTES = 4 * 1024 * 1024;
var REQUEST_BODY_TIMEOUT_MS = 15 * 1e3;
var MAX_SESSIONS = 32;
var SESSION_TTL_MS = 30 * 60 * 1e3;
var SESSION_COOKIE = "dsh_poker_night_sid";
var SESSION_HEADER = "x-poker-night-session";
var MEDIA_PARAM = "t";
var MUTATING_METHODS = ["start", "act", "next-hand", "reset", "set-avatar", "clear-avatar", "lan"];
var LAN_POLL_MS = 500;
var BOTS = [
  { id: "altman", name: "Altman", emoji: "A", brand: "openai", company: "OpenAI", loose: 0.04, agg: 0.58, bluff: 0.08, tag: "OpenAI", style: "\u4F60\u662F OpenAI \u521B\u59CB\u4EBA Sam Altman\u3002\u7D27\u51F6\u3001\u7231\u8BB2\u613F\u666F\uFF0C\u4F46\u724C\u684C\u4E0A\u7EDD\u4E0D\u9732\u5E95\u3002\u5783\u573E\u724C\u5C31\u5F03\uFF0C\u5F3A\u724C\u4EF7\u503C\u4E0B\u6CE8\uFF0C\u5F88\u5C11\u5927\u989D\u8BC8\u552C\u3002" },
  { id: "dario", name: "\u8FBE\u91CC\u5965", emoji: "D", brand: "anthropic", company: "Anthropic", loose: -0.1, agg: 0.22, bluff: 0.03, tag: "Anthropic", style: "\u4F60\u662F Anthropic \u521B\u59CB\u4EBA Dario Amodei\u3002\u6781\u7D27\u3001\u5B89\u5168\u4F18\u5148\u3002\u53EA\u6709\u5F3A\u6210\u724C\u6216\u5927\u542C\u724C\u624D\u7EE7\u7EED\uFF0C\u51E0\u4E4E\u4E0D\u8BC8\u552C\u3002" },
  { id: "musk", name: "\u9A6C\u65AF\u514B", emoji: "X", brand: "xai", company: "xAI", loose: 0.3, agg: 0.88, bluff: 0.36, tag: "xAI", style: "\u4F60\u662F xAI \u521B\u59CB\u4EBA\u57C3\u9686\xB7\u9A6C\u65AF\u514B\u3002\u75AF\u5B50\u6253\u6CD5\uFF1A\u5C3A\u5EA6\u5938\u5F20\u3001\u7231\u505A\u5927\u989D\u65BD\u538B\u3001\u95F2\u8BDD\u77ED\u4FC3\u5E26\u523A\u3001\u5076\u5C14\u4E71\u8BC8\uFF1B\u4F46\u53EA\u6709\u724C\u529B\u771F\u7684\u591F\u5F3A\u65F6\u624D\u63A8\u5149\uFF0C\u4E0D\u8981\u6BCF\u624B\u90FD\u5168\u4E0B\u3002" },
  { id: "liang", name: "\u6881\u6587\u5CF0", emoji: "\u6881", brand: "deepseek", company: "DeepSeek", loose: 0.16, agg: 0.72, bluff: 0.22, tag: "DeepSeek", style: "\u4F60\u662F DeepSeek \u521B\u59CB\u4EBA\u6881\u6587\u5CF0\u3002\u9AD8\u6548\u677E\u51F6\uFF0C\u5C3A\u5EA6\u591A\u53D8\uFF0C\u4F1A\u7A81\u7136\u52A0\u6CE8\uFF0C\u4E13\u5403\u8F6F\u73A9\u5BB6\u3002" },
  { id: "jensen", name: "\u9EC4\u4EC1\u52CB", emoji: "\u9EC4", brand: "nvidia", company: "NVIDIA", loose: 0.12, agg: 0.7, bluff: 0.12, tag: "NVIDIA", style: "\u4F60\u662F NVIDIA \u521B\u59CB\u4EBA\u9EC4\u4EC1\u52CB\u3002\u70ED\u60C5\u3001\u6301\u7EED\u65BD\u538B\u3001\u7231\u4EF7\u503C\u4E0B\u6CE8\u3002\u95F2\u8BDD\u50CF\u53D1\u5E03\u4F1A\uFF0C\u4F46\u4E0D\u63D0\u724C\u9762\u3002" },
  { id: "leijun", name: "\u96F7\u519B", emoji: "\u96F7", brand: "xiaomi", company: "\u5C0F\u7C73", loose: 0.2, agg: 0.64, bluff: 0.18, tag: "Xiaomi", style: '\u4F60\u662F\u5C0F\u7C73\u521B\u59CB\u4EBA\u96F7\u519B\u3002\u4EB2\u548C\u3001\u8282\u594F\u611F\u5F3A\uFF0C\u7231\u7528"\u539A\u9053\u4EF7"\u505A\u4EF7\u503C\u4E0B\u6CE8\uFF0C\u5C3A\u5EA6\u514B\u5236\uFF0C\u4F46\u5173\u952E\u724C\u4F1A\u7A81\u7136\u52A0\u6CE8\uFF1B\u95F2\u8BDD\u50CF\u53D1\u5E03\u4F1A\uFF0C\u70ED\u60C5\u3001\u4E0D\u63D0\u724C\u9762\u3002' },
  { id: "yiming", name: "\u5F20\u4E00\u9E23", emoji: "\u5F20", brand: "bytedance", company: "\u5B57\u8282\u8DF3\u52A8", loose: 0.06, agg: 0.52, bluff: 0.1, tag: "ByteDance", style: "\u4F60\u662F\u5B57\u8282\u8DF3\u52A8\u521B\u59CB\u4EBA\u5F20\u4E00\u9E23\u3002\u51B7\u9759\u3001\u7EAA\u5F8B\u6781\u5F3A\u3001\u5EF6\u8FDF\u6EE1\u8DB3\uFF1A\u5783\u573E\u724C\u4E00\u5F8B\u5F03\uFF0C\u53EA\u5728\u671F\u671B\u4E3A\u6B63\u65F6\u7EE7\u7EED\uFF0C\u5F88\u5C11\u8BC8\u552C\uFF0C\u4E5F\u4E0D\u4E3A\u60C5\u7EEA\u52A0\u6CE8\u3002" }
];
var ACT_TOOL = {
  name: "holdem_act",
  description: "Take exactly one legal No-Limit Hold'em action.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["fold", "check", "call", "raise", "allin"], description: "allin = \u628A\u5168\u90E8\u7B79\u7801\u4E00\u6B21\u63A8\u4E0A\u53BB\uFF0C\u53EA\u5728\u5C11\u6570\u60C5\u51B5\u4F7F\u7528\uFF1B\u666E\u901A\u52A0\u6CE8\u8BF7\u7528 raise\u3002" },
      amount: { type: "number", description: "Raise-to total in tokens, required for type=raise. Must sit inside the raise range given in the prompt." },
      talk: { type: "string", description: "\u5FC5\u586B\u684C\u8FB9\u95F2\u8BDD\uFF0C\u5FC5\u987B\u662F\u7B80\u4F53\u4E2D\u6587\uFF0C\u6700\u591A16\u4E2A\u5B57\u3002\u53EF\u4EE5\u865A\u5F20\u58F0\u52BF\uFF0C\u4F46\u7981\u6B62\u63D0\u5230\u5E95\u724C\u3001\u82B1\u8272\u3001\u70B9\u6570\u3001\u542C\u724C\u3001\u6210\u724C\u6216\u4EFB\u4F55\u63A8\u7406\u8FC7\u7A0B\u3002" }
    },
    required: ["type", "talk"]
  }
};
function parseJsonObject(text) {
  if (!text) return null;
  const raw = String(text);
  try {
    return JSON.parse(raw);
  } catch (e) {
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}
function createPlayer(spec, seat) {
  return {
    id: spec.id,
    name: spec.name,
    emoji: spec.emoji,
    brand: spec.brand || "",
    company: spec.company || "",
    kind: spec.kind,
    tag: spec.tag || "",
    loose: spec.loose || 0,
    agg: spec.agg || 0.4,
    bluff: spec.bluff || 0.1,
    seat,
    stack: START_STACK,
    rebuys: 0,
    out: false,
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    acted: false,
    cards: [],
    lastAction: "",
    lastThought: "",
    talk: "",
    talkHistory: [],
    style: spec.style || ""
  };
}
function createTable(ctx, options) {
  const mediaToken = options && options.mediaToken || "";
  const state = {
    status: "idle",
    handNo: 0,
    street: "preflop",
    dealer: 5,
    board: [],
    deck: [],
    currentBet: 0,
    minRaise: BB,
    toAct: null,
    sbSeat: null,
    bbSeat: null,
    gameOver: false,
    winners: [],
    revealed: false,
    lastPot: 0,
    thinkEndsAt: 0,
    actionLog: [],
    timeline: [],
    tlSeq: 0,
    agentModel: "",
    log: ["Click Start to sit with five agents."]
  };
  const players = [createPlayer({ id: "hero", name: "you", emoji: "\u{1F9D1}", kind: "human", tag: "Hero" }, 0)];
  for (let i = 0; i < BOTS.length; i++) {
    players.push(createPlayer(Object.assign({ kind: "ai" }, BOTS[i]), i + 1));
  }
  const avatarDir = avatarDataDir();
  const overrides = loadOverrides(avatarDir);
  const bundled = loadBundled();
  let aiTimer = null;
  let aiSeq = 0;
  let aiAbort = null;
  function log(text) {
    state.log = state.log.concat([text]).slice(-10);
  }
  function record(entry) {
    state.tlSeq = (state.tlSeq || 0) + 1;
    state.timeline = (state.timeline || []).concat([{
      id: state.tlSeq,
      at: Date.now(),
      handNo: state.handNo,
      street: entry.street || state.street || "",
      kind: entry.kind || "action",
      name: entry.name || "",
      emoji: entry.emoji || "",
      playerId: entry.playerId || "",
      action: entry.action || "",
      talk: entry.talk || ""
    }]).slice(-160);
  }
  function clearAi() {
    aiSeq += 1;
    if (aiTimer) {
      aiTimer();
      aiTimer = null;
    }
    if (aiAbort) {
      aiAbort.abort();
      aiAbort = null;
    }
  }
  function pot() {
    let n = 0;
    for (let i = 0; i < players.length; i++) n += players[i].committed;
    return n;
  }
  function live() {
    return players.filter(function(p) {
      return !p.folded;
    });
  }
  function canAct(p) {
    return !p.folded && !p.allIn && p.stack >= 0;
  }
  function cw(from, steps) {
    const n = players.length;
    const k = steps == null ? 1 : steps;
    return (from - k % n + n) % n;
  }
  function nextIndex(from) {
    for (let i = 1; i <= players.length; i++) {
      const p = players[cw(from, i)];
      if (!p.folded && !p.allIn) return p.seat;
    }
    return null;
  }
  function put(p, amount) {
    const n = Math.max(0, Math.min(amount, p.stack));
    p.stack -= n;
    p.bet += n;
    p.committed += n;
    if (p.stack === 0) p.allIn = true;
    return n;
  }
  function resetStreetFlags() {
    for (let i = 0; i < players.length; i++) {
      players[i].bet = 0;
      players[i].acted = false;
      if (!players[i].folded && players[i].stack === 0) players[i].allIn = true;
    }
    state.currentBet = 0;
    state.minRaise = BB;
  }
  function legalFor(p) {
    if (!p || state.status !== "playing" || state.toAct !== p.seat) {
      return { fold: false, check: false, call: false, callAmount: 0, raise: false, minRaiseTo: 0, maxRaiseTo: 0, toCall: 0 };
    }
    const toCall = Math.max(0, state.currentBet - p.bet);
    const maxRaiseTo = p.bet + p.stack;
    const minRaiseTo = state.currentBet === 0 ? Math.max(BB, state.minRaise) : state.currentBet + state.minRaise;
    return {
      fold: true,
      check: toCall === 0,
      call: toCall > 0,
      callAmount: Math.min(toCall, p.stack),
      raise: p.stack > toCall,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      toCall
    };
  }
  function snapshot(viewer) {
    const viewerSeat = Number.isInteger(viewer) ? viewer : 0;
    const hero = players[viewerSeat] || players[0];
    const legal = legalFor(state.toAct == null ? null : players[state.toAct]);
    return {
      status: state.status,
      handNo: state.handNo,
      street: state.street,
      dealer: state.dealer,
      sb: SB,
      bb: BB,
      pot: pot(),
      lastPot: state.lastPot,
      board: state.board.slice(),
      toAct: state.toAct,
      currentBet: state.currentBet,
      minRaise: state.minRaise,
      winners: state.winners,
      revealed: state.revealed,
      gameOver: !!state.gameOver,
      maxRebuys: MAX_REBUYS,
      thinkEndsAt: state.thinkEndsAt || 0,
      agentModel: state.agentModel || "",
      log: state.log.slice(),
      timeline: (state.timeline || []).slice(),
      legal,
      heroHand: hero.cards.length >= 5 || state.board.length >= 3 ? evalBest(hero.cards.concat(state.board)).name : hero.cards.length === 2 ? "\u5E95\u724C" : "",
      players: players.map(function(p) {
        const isWinner = (state.winners || []).some(function(w) {
          return (w.seats || []).indexOf(p.seat) !== -1;
        });
        const show = p.seat === viewerSeat || state.revealed || state.status === "hand-over" && isWinner && !p.folded;
        return {
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          brand: p.brand || "",
          company: p.company || "",
          kind: p.kind,
          remote: !!p.remote,
          tag: p.tag,
          seat: p.seat,
          stack: p.stack,
          rebuys: p.rebuys || 0,
          out: !!p.out,
          bet: p.bet,
          committed: p.committed,
          folded: p.folded,
          allIn: p.allIn,
          isDealer: p.seat === state.dealer,
          isSb: p.seat === state.sbSeat,
          isBb: p.seat === state.bbSeat,
          isToAct: state.toAct === p.seat && state.status === "playing",
          lastAction: p.lastAction,
          lastThought: "",
          talk: p.talk || "",
          avatar: avatarView(p.id, overrides, bundled, mediaToken),
          hasCards: p.cards.length === 2,
          cards: show ? p.cards.slice() : [],
          handName: show && p.cards.length === 2 && (state.revealed || p.seat === viewerSeat) && state.board.length >= 3 ? evalBest(p.cards.concat(state.board)).name : ""
        };
      })
    };
  }
  function findNextActor(from) {
    for (let i = 1; i <= players.length; i++) {
      const p = players[cw(from, i)];
      if (!p.folded && !p.allIn && (!p.acted || p.bet < state.currentBet)) return p.seat;
    }
    return null;
  }
  function streetClosed() {
    const alive = live();
    if (alive.length <= 1) return true;
    const actors = alive.filter(function(p) {
      return !p.allIn;
    });
    if (actors.length === 0) return true;
    if (actors.length === 1 && actors[0].bet >= state.currentBet) return true;
    return actors.every(function(p) {
      return p.acted && p.bet === state.currentBet;
    });
  }
  function seatOrder(seat) {
    return (state.dealer - seat - 1 + players.length) % players.length;
  }
  function finishFoldWin() {
    const winner = live()[0];
    const amount = pot();
    winner.stack += amount;
    state.lastPot = amount;
    state.winners = [{ seats: [winner.seat], names: [winner.name], amount, handName: "\u65E0\u4EBA\u8DDF\u6CE8" }];
    for (let i = 0; i < players.length; i++) players[i].committed = 0;
    state.status = "hand-over";
    state.toAct = null;
    state.revealed = false;
    log(winner.name + " \u6536\u8D70\u5E95\u6C60 " + amount);
    record({ kind: "result", name: winner.name, emoji: winner.emoji, playerId: winner.id, action: "\u6536\u8D70\u5E95\u6C60 " + amount, street: state.street });
  }
  function showdown() {
    state.revealed = true;
    state.status = "showdown";
    state.toAct = null;
    const pots = makePots(players);
    const results = [];
    for (let i = 0; i < pots.length; i++) {
      const potItem = pots[i];
      const scored = potItem.eligible.map(function(p) {
        return { p, ev: evalBest(p.cards.concat(state.board)) };
      });
      let best = -1;
      for (let j = 0; j < scored.length; j++) if (scored[j].ev.score > best) best = scored[j].ev.score;
      const winners = scored.filter(function(s) {
        return s.ev.score === best;
      });
      winners.sort(function(a, b) {
        return seatOrder(a.p.seat) - seatOrder(b.p.seat);
      });
      const share = Math.floor(potItem.amount / winners.length);
      let rem = potItem.amount - share * winners.length;
      for (let j = 0; j < winners.length; j++) {
        winners[j].p.stack += share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
      results.push({
        seats: winners.map(function(w) {
          return w.p.seat;
        }),
        names: winners.map(function(w) {
          return w.p.name;
        }),
        amount: potItem.amount,
        handName: winners[0].ev.name
      });
      log(winners.map(function(w) {
        return w.p.name;
      }).join("\u3001") + " \u4EE5" + winners[0].ev.name + " \u8D62\u4E0B " + potItem.amount);
      record({
        kind: "result",
        name: winners.map(function(w) {
          return w.p.name;
        }).join("\u3001"),
        emoji: winners[0].p.emoji,
        playerId: winners[0].p.id,
        action: winners[0].ev.name + " \xB7 " + potItem.amount,
        street: "showdown"
      });
    }
    state.winners = results;
    state.lastPot = results.reduce(function(s, r) {
      return s + r.amount;
    }, 0);
    for (let i = 0; i < players.length; i++) players[i].committed = 0;
    state.status = "hand-over";
  }
  function dealStreet() {
    if (state.street === "preflop") {
      state.deck.pop();
      state.board = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
      state.street = "flop";
      log("\u7FFB\u724C");
      record({ kind: "street", action: "\u7FFB\u724C", street: "flop" });
    } else if (state.street === "flop") {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = "turn";
      log("\u8F6C\u724C");
      record({ kind: "street", action: "\u8F6C\u724C", street: "turn" });
    } else if (state.street === "turn") {
      state.deck.pop();
      state.board.push(state.deck.pop());
      state.street = "river";
      log("\u6CB3\u724C");
      record({ kind: "street", action: "\u6CB3\u724C", street: "river" });
    } else {
      showdown();
      return;
    }
    resetStreetFlags();
    if (maybeRunout()) return;
    state.toAct = findNextActor(state.dealer);
    if (state.toAct == null) {
      if (state.street === "river") showdown();
      else dealStreet();
    }
  }
  function maybeRunout() {
    const alive = live();
    if (alive.length <= 1) return false;
    const actors = alive.filter(function(p) {
      return !p.allIn;
    });
    if (actors.length === 0 || actors.length === 1 && actors[0].bet >= state.currentBet) {
      while (state.street !== "river" && state.status === "playing") {
        if (state.street === "preflop") {
          state.deck.pop();
          state.board = [state.deck.pop(), state.deck.pop(), state.deck.pop()];
          state.street = "flop";
        } else if (state.street === "flop") {
          state.deck.pop();
          state.board.push(state.deck.pop());
          state.street = "turn";
        } else if (state.street === "turn") {
          state.deck.pop();
          state.board.push(state.deck.pop());
          state.street = "river";
        }
      }
      if (state.status === "playing") showdown();
      return true;
    }
    return false;
  }
  function afterAction() {
    if (live().length <= 1) {
      finishFoldWin();
      return;
    }
    if (streetClosed()) {
      if (state.street === "river") showdown();
      else dealStreet();
      return;
    }
    if (state.toAct == null) return;
    state.toAct = findNextActor(state.toAct);
    if (state.toAct == null) {
      if (state.street === "river") showdown();
      else dealStreet();
    }
  }
  function applyAction(p, type, amount) {
    const toCall = Math.max(0, state.currentBet - p.bet);
    if (type === "fold") {
      if (toCall === 0) type = "check";
      else {
        p.folded = true;
        p.acted = true;
        p.lastAction = "\u5F03\u724C";
        log(p.name + " \u5F03\u724C");
        return;
      }
    }
    if (type === "check") {
      if (toCall > 0) {
        applyAction(p, "call", 0);
        return;
      }
      p.acted = true;
      p.lastAction = "\u8FC7\u724C";
      log(p.name + " \u8FC7\u724C");
      return;
    }
    if (type === "call") {
      if (toCall === 0) {
        applyAction(p, "check", 0);
        return;
      }
      const paid = put(p, toCall);
      p.acted = true;
      p.lastAction = p.allIn ? "\u5168\u4E0B " + paid : "\u8DDF\u6CE8 " + paid;
      log(p.name + " " + p.lastAction);
      return;
    }
    if (type === "allin") {
      const target = p.bet + p.stack;
      applyAction(p, "raise", target);
      return;
    }
    if (type === "raise" || type === "bet") {
      let target = typeof amount === "number" ? Math.floor(amount) : 0;
      const maxTo = p.bet + p.stack;
      if (target <= 0) target = state.currentBet === 0 ? BB : state.currentBet + state.minRaise;
      if (target > maxTo) target = maxTo;
      if (target <= p.bet) {
        applyAction(p, toCall > 0 ? "call" : "check", 0);
        return;
      }
      if (target < state.currentBet) {
        applyAction(p, "call", 0);
        return;
      }
      const need = target - p.bet;
      const raiseBy = target - state.currentBet;
      put(p, need);
      const isRaise = target > state.currentBet;
      if (isRaise) {
        if (raiseBy >= state.minRaise || p.allIn) {
          if (raiseBy >= state.minRaise) state.minRaise = raiseBy;
          for (let i = 0; i < players.length; i++) {
            if (players[i] !== p && !players[i].folded && !players[i].allIn) players[i].acted = false;
          }
        }
        state.currentBet = p.bet;
      }
      p.acted = true;
      if (p.allIn) p.lastAction = "\u5168\u4E0B " + p.bet;
      else if (state.currentBet === p.bet && raiseBy > 0 && toCall === 0) p.lastAction = "\u4E0B\u6CE8 " + p.bet;
      else p.lastAction = "\u52A0\u6CE8\u81F3 " + p.bet;
      log(p.name + " " + p.lastAction);
    }
  }
  function decideAiRaw(p) {
    const toCall = Math.max(0, state.currentBet - p.bet);
    const hs = strength(p.cards, state.board) + p.loose;
    const potNow = pot();
    const odds = toCall === 0 ? 0 : toCall / (potNow + toCall);
    const roll = Math.random();
    if (toCall === 0) {
      if (hs > 0.62 && roll < p.agg) {
        const size = Math.floor(potNow * (0.5 + p.agg * 0.4));
        return { type: "raise", amount: Math.max(BB, p.bet + size) };
      }
      if (hs > 0.5 && roll < p.bluff * 1.4) {
        return { type: "raise", amount: p.bet + Math.max(BB, Math.floor(potNow * 0.66)) };
      }
      return { type: "check" };
    }
    if (hs + 0.08 < odds && toCall > p.stack * 0.12 && roll > p.bluff) return { type: "fold" };
    if (hs > 0.7 && roll < p.agg) {
      const size = Math.floor((potNow + toCall) * (0.6 + p.agg * 0.5));
      return { type: "raise", amount: state.currentBet + Math.max(state.minRaise, size) };
    }
    if (hs > 0.55 && roll < p.bluff + 0.15) {
      return { type: "raise", amount: state.currentBet + Math.max(state.minRaise, Math.floor((potNow + toCall) * 0.75)) };
    }
    if (toCall >= p.stack) return { type: "call" };
    if (hs + p.loose * 0.5 >= odds - 0.08) return { type: "call" };
    if (toCall <= BB && hs > 0.28) return { type: "call" };
    return { type: "fold" };
  }
  function decideAi(p) {
    const choice = decideAiRaw(p);
    if (!choice || choice.type !== "raise") return choice;
    const legal = legalFor(p);
    if (!legal.raise) return { type: legal.check ? "check" : "call" };
    return { type: "raise", amount: clampRaise(choice.amount, raiseOpts(legal)) };
  }
  function raiseOpts(legal) {
    return {
      pot: pot(),
      currentBet: state.currentBet,
      bb: BB,
      minR: legal.minRaiseTo,
      maxR: legal.maxRaiseTo
    };
  }
  function normalizeChoice(raw, legal, fallback) {
    const type = raw && typeof raw.type === "string" ? raw.type.toLowerCase() : "";
    const talk = sanitizeTalk(raw && raw.talk);
    if (type === "check" && legal.check) return { type: "check", talk };
    if (type === "fold" && legal.fold) return { type: legal.toCall > 0 ? "fold" : "check", talk };
    if (type === "call" && legal.call) return { type: "call", talk };
    if (type === "call" && legal.check) return { type: "check", talk };
    if (type === "allin" && legal.raise) return { type: "raise", amount: legal.maxRaiseTo, talk };
    if ((type === "raise" || type === "bet") && legal.raise) {
      return { type: "raise", amount: clampRaise(raw.amount, raiseOpts(legal)), talk };
    }
    return fallback;
  }
  function describeLegal(legal) {
    const parts = [];
    if (legal.fold && legal.toCall > 0) parts.push("fold");
    if (legal.check) parts.push("check");
    if (legal.call) parts.push("call " + legal.callAmount + " more tokens");
    if (legal.raise) {
      const opts = raiseOpts(legal);
      const top = raiseCeiling(opts);
      const potNow = Math.max(1, opts.pot);
      parts.push("raise: amount = the raise-to total, from " + legal.minRaiseTo + " to " + top + " (about " + Math.round(legal.minRaiseTo / potNow * 10) / 10 + "\u2013" + Math.round(top / potNow * 10) / 10 + "\xD7 the " + potNow + " token pot)");
      if (legal.maxRaiseTo > top) {
        parts.push("allin: " + legal.maxRaiseTo + " (your entire stack) \u2014 a separate, deliberate choice, never the top of the raise range");
      }
    }
    return parts.join("; ");
  }
  function buildPrompt(p, legal) {
    const others = players.map(function(o) {
      const who = o.seat === p.seat ? "YOU" : o.kind === "human" ? "the human" : o.name;
      return "- seat " + o.seat + " " + who + ": stack " + o.stack + ", bet " + o.bet + (o.folded ? ", folded" : "") + (o.allIn ? ", all-in" : "") + (o.lastAction ? ", last " + o.lastAction : "");
    }).join("\n");
    const history = (state.actionLog || []).length ? (state.actionLog || []).join("\n") : "(no actions yet this hand)";
    return [
      "Hand #" + state.handNo + " \xB7 " + state.street + " \xB7 pot " + pot() + " tokens \xB7 current bet " + state.currentBet,
      "Blinds " + SB + "/" + BB + ". Your stack " + p.stack + " tokens (about " + Math.round(p.stack / BB) + " big blinds); you have " + p.bet + " tokens in front of you this street.",
      "Your hole cards: " + p.cards.map(cardTxt).join(" "),
      "Board: " + (state.board.length ? state.board.map(cardTxt).join(" ") : "(none)"),
      "Players:\n" + others,
      "Action so far:\n" + history,
      "Legal actions: " + describeLegal(legal),
      "\u9009\u62E9\u4E00\u4E2A\u5408\u6CD5\u52A8\u4F5C\u3002\u91D1\u989D\u8981\u548C\u5E95\u6C60\u76F8\u79F0\uFF1A\u9664\u975E\u4F60\u771F\u7684\u6253\u7B97\u628A\u5168\u90E8\u7B79\u7801\u538B\u4E0A\uFF08\u90A3\u624D\u9009 allin\uFF09\uFF0C\u5426\u5219\u4E0D\u8981\u628A raise \u7684 amount \u5199\u6210\u533A\u95F4\u4E0A\u754C\u3002talk \u5FC5\u987B\u586B\u5199\u7B80\u4F53\u4E2D\u6587\u95F2\u8BDD\uFF0C\u6700\u591A\u5341\u516D\u4E2A\u5B57\u3002\u53EF\u4EE5\u865A\u5F20\u58F0\u52BF\u6216\u6545\u610F\u8BF4\u4E0D\u51C6\u786E\u7684\u8BDD\uFF0C\u4F46\u7981\u6B62\u5728 talk \u91CC\u63D0\u5230\u5E95\u724C\u3001\u82B1\u8272\u3001\u70B9\u6570\u3001\u724C\u578B\u3001\u542C\u724C\u6216\u4EFB\u4F55\u63A8\u7406\u3002"
    ].join("\n\n");
  }
  function askAgent(p) {
    const legal = legalFor(p);
    const fallback = decideAi(p);
    const llm = ctx.get("llm");
    const models = ctx.get("agentDefaultModel");
    if (llm === void 0 || models === void 0) {
      state.agentModel = "heuristic";
      return Promise.resolve(fallback);
    }
    const sel = models.currentSelection();
    if (!sel || !sel.provider || !sel.model) {
      state.agentModel = "heuristic";
      return Promise.resolve(fallback);
    }
    state.agentModel = sel.provider + "/" + sel.model;
    const system = [
      "\u4F60\u662F\u5FB7\u5DDE\u6251\u514B\u724C\u684C\u4E0A\u7684\u73A9\u5BB6\u300C" + p.name + "\u300D" + (p.company ? "\uFF08" + p.company + "\uFF09" : "") + "\u3002",
      "\u98CE\u683C\uFF1A" + (p.style || p.tag || "\u5747\u8861"),
      "\u4F60\u53EA\u80FD\u770B\u89C1\u81EA\u5DF1\u7684\u5E95\u724C\u3002\u7B79\u7801\u5355\u4F4D\u662F tokens\u3002",
      "\u7528 holdem_act \u505A\u51FA\u4E00\u4E2A\u5408\u6CD5\u52A8\u4F5C\u3002amount \u662F\u52A0\u6CE8\u5230\u7684\u603B\u989D\u3002",
      "talk \u5FC5\u987B\u586B\u5199\u7B80\u4F53\u4E2D\u6587\u684C\u8FB9\u95F2\u8BDD\uFF0C\u6700\u591A\u5341\u516D\u4E2A\u5B57\uFF0C\u7B26\u5408\u4EBA\u8BBE\u3002",
      "\u4F60\u53EF\u4EE5\u865A\u5F20\u58F0\u52BF\uFF0C\u6545\u610F\u8C0E\u79F0\u81EA\u5DF1\u7684\u610F\u56FE\u6216\u4FE1\u5FC3\uFF0C\u8FD9\u4E9B\u8BDD\u4E0D\u5FC5\u7B26\u5408\u771F\u5B9E\u724C\u529B\u3002",
      "\u7EDD\u5BF9\u4E0D\u8981\u5728 talk \u91CC\u63D0\u5230\u5E95\u724C\u3001\u82B1\u8272\u3001\u70B9\u6570\u3001\u724C\u578B\u3001\u542C\u724C\u3001\u6210\u724C\u3001\u80DC\u7387\u6216\u4EFB\u4F55\u63A8\u7406\u8FC7\u7A0B\u3002"
    ].join("");
    const options2 = {
      provider: sel.provider,
      model: sel.model,
      system,
      messages: [{
        id: "hk-" + p.id + "-" + state.handNo + "-" + Date.now(),
        role: "user",
        content: [{ type: "text", text: buildPrompt(p, legal) }],
        source: { kind: "plugin", plugin: "holdem" }
      }],
      tools: [ACT_TOOL],
      temperature: 0.7,
      maxTokens: 700
    };
    if (sel.reasoningEffort) options2.reasoningEffort = sel.reasoningEffort;
    const controller = new AbortController();
    aiAbort = controller;
    options2.signal = controller.signal;
    return (async function() {
      try {
        let text = "";
        let toolArgs = "";
        for await (const chunk of llm.stream(options2)) {
          if (chunk.type === "text-delta" && chunk.text) {
            text += chunk.text;
          } else if (chunk.type === "tool-call-delta" && chunk.argumentsDelta) {
            toolArgs += chunk.argumentsDelta;
          } else if (chunk.type === "block-end" && chunk.block && chunk.block.type === "tool-call") {
            toolArgs = chunk.block.arguments || toolArgs;
          } else if (chunk.type === "finish" && chunk.reason && (chunk.reason.kind === "error" || chunk.reason.kind === "aborted")) {
            const msg = chunk.reason.failure && chunk.reason.failure.message;
            throw new Error(msg || "llm finish " + chunk.reason.kind);
          }
        }
        const parsed = parseJsonObject(toolArgs) || parseJsonObject(text);
        return normalizeChoice(parsed, legal, fallback);
      } finally {
        if (aiAbort === controller) aiAbort = null;
      }
    })();
  }
  function setAiTalk(p, action, raw) {
    const history = p.talkHistory || [];
    const modelTalk = sanitizeTalk(raw);
    p.talk = modelTalk && modelTalk !== history[history.length - 1] ? modelTalk : fallbackTalk(p, action, Math.random, history);
    p.talkHistory = history.concat([p.talk]).slice(-6);
    return p.talk;
  }
  function commitAi(p, choice) {
    applyAction(p, choice.type, choice.amount);
    setAiTalk(p, choice && choice.type, choice && choice.talk);
    state.actionLog = (state.actionLog || []).concat([state.street + ": " + p.name + " " + p.lastAction]).slice(-16);
    record({ kind: "action", name: p.name, emoji: p.emoji, playerId: p.id, action: p.lastAction, talk: p.talk });
    afterAction();
    scheduleAi();
  }
  function runAi(seq, seat, handNo2) {
    if (seq !== aiSeq) return;
    const p = players[seat];
    if (!p || p.kind !== "ai" || state.status !== "playing" || state.toAct !== seat || state.handNo !== handNo2) return;
    askAgent(p).then(function(choice) {
      if (seq !== aiSeq) return;
      if (state.status !== "playing" || state.toAct !== seat || state.handNo !== handNo2) return;
      commitAi(p, choice);
    }).catch(function(err) {
      console.error(err);
      if (seq !== aiSeq) return;
      if (state.status !== "playing" || state.toAct !== seat || state.handNo !== handNo2) return;
      commitAi(p, decideAi(p));
    });
  }
  function scheduleAi() {
    clearAi();
    state.thinkEndsAt = 0;
    if (state.status !== "playing" || state.toAct == null) return;
    const p = players[state.toAct];
    if (!p || p.kind !== "ai") return;
    const seq = aiSeq;
    const seat = p.seat;
    const handNo2 = state.handNo;
    p.lastThought = "";
    p.talk = "";
    state.thinkEndsAt = Date.now() + 45e3;
    aiTimer = ctx.timeout(function() {
      aiTimer = null;
      runAi(seq, seat, handNo2);
    }, 40);
  }
  function endGame(message) {
    clearAi();
    state.gameOver = true;
    state.status = "game-over";
    state.toAct = null;
    state.winners = [];
    state.revealed = false;
    state.sbSeat = null;
    state.bbSeat = null;
    state.dealer = null;
    for (let i = 0; i < players.length; i++) {
      players[i].cards = [];
      players[i].bet = 0;
      players[i].committed = 0;
      players[i].allIn = false;
      players[i].acted = false;
      players[i].lastAction = "";
    }
    log(message);
  }
  function dealHand() {
    clearAi();
    let liveCount = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const decision = rebuyDecision(p, { max: MAX_REBUYS, start: START_STACK });
      if (decision.action === "rebuy") {
        p.rebuys = decision.rebuys;
        p.stack = decision.stack;
        log(p.name + " \u91CD\u65B0\u4E70\u5165 " + START_STACK + "\uFF08\u7B2C " + p.rebuys + "/" + MAX_REBUYS + " \u6B21\uFF09");
      } else if (decision.action === "out" && !p.out) {
        p.out = true;
        log(p.name + " \u4E70\u5165\u7528\u5C3D\uFF0C\u51FA\u5C40");
      }
      if (!p.out) liveCount += 1;
      p.bet = 0;
      p.committed = 0;
      p.folded = !!p.out;
      p.allIn = false;
      p.acted = false;
      p.cards = [];
      p.lastAction = "";
      p.lastThought = "";
      p.talk = "";
      p.talkHistory = [];
    }
    if (liveCount < 2) {
      endGame("\u53EA\u5269\u4E00\u540D\u73A9\u5BB6\uFF0C\u724C\u684C\u7ED3\u675F\u3002\u70B9\u300CReset\u300D\u518D\u5F00\u4E00\u684C\u3002");
      return;
    }
    if (players[0].out) {
      endGame("\u4F60\u7684 " + MAX_REBUYS + " \u6B21\u4E70\u5165\u5DF2\u7ECF\u7528\u5B8C\uFF0C\u672C\u5C40\u7ED3\u675F\u3002\u70B9\u300CReset\u300D\u518D\u5F00\u4E00\u684C\u3002");
      return;
    }
    state.handNo += 1;
    let dealer = cw(state.dealer);
    for (let i = 0; i < players.length && players[dealer].out; i++) dealer = cw(dealer);
    state.dealer = dealer;
    state.deck = shuffle(makeDeck());
    state.board = [];
    state.street = "preflop";
    state.winners = [];
    state.revealed = false;
    state.status = "playing";
    state.lastPot = 0;
    state.actionLog = [];
    const activeSeats = players.filter(function(p) {
      return !p.out;
    }).map(function(p) {
      return p.seat;
    });
    const blinds = blindSeats(players.length, activeSeats, state.dealer);
    state.sbSeat = blinds.sb;
    state.bbSeat = blinds.bb;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < players.length; i++) {
        const p = players[cw(state.dealer, 1 + i)];
        if (!p.out) p.cards.push(state.deck.pop());
      }
    }
    const sbSeat = blinds.sb;
    const bbSeat = blinds.bb;
    put(players[sbSeat], SB);
    players[sbSeat].lastAction = "\u5C0F\u76F2 " + players[sbSeat].bet;
    if (players[sbSeat].kind === "ai") setAiTalk(players[sbSeat], "blind");
    put(players[bbSeat], BB);
    players[bbSeat].lastAction = "\u5927\u76F2 " + players[bbSeat].bet;
    if (players[bbSeat].kind === "ai") setAiTalk(players[bbSeat], "blind");
    state.currentBet = players[bbSeat].bet;
    state.minRaise = BB;
    log("\u7B2C " + state.handNo + " \u624B \xB7 " + players[state.dealer].name + " \u5750\u5E84");
    record({ kind: "street", action: "\u7B2C " + state.handNo + " \u624B", street: "preflop", name: players[state.dealer].name, emoji: players[state.dealer].emoji, playerId: players[state.dealer].id });
    record({ kind: "action", name: players[sbSeat].name, emoji: players[sbSeat].emoji, playerId: players[sbSeat].id, action: players[sbSeat].lastAction, talk: players[sbSeat].talk || "", street: "preflop" });
    record({ kind: "action", name: players[bbSeat].name, emoji: players[bbSeat].emoji, playerId: players[bbSeat].id, action: players[bbSeat].lastAction, talk: players[bbSeat].talk || "", street: "preflop" });
    state.toAct = findNextActor(bbSeat);
    if (state.toAct == null) {
      maybeRunout();
      return;
    }
    scheduleAi();
  }
  function start() {
    state.handNo = 0;
    state.gameOver = false;
    state.dealer = Math.floor(Math.random() * players.length);
    for (let i = 0; i < players.length; i++) {
      players[i].stack = START_STACK;
      players[i].rebuys = 0;
      players[i].out = false;
    }
    state.log = [];
    log("\u65B0\u724C\u684C\uFF1A\u76F2\u6CE8 " + SB + "/" + BB + "\uFF0C\u8BB0\u5206\u724C " + START_STACK + "\uFF0C\u6BCF\u4EBA " + MAX_REBUYS + " \u6B21\u4E70\u5165");
    dealHand();
    return snapshot();
  }
  function nextHand() {
    if (state.gameOver) return snapshot();
    if (state.status === "idle") return start();
    if (state.status === "playing") return snapshot();
    dealHand();
    return snapshot();
  }
  function reset() {
    clearAi();
    state.status = "idle";
    state.handNo = 0;
    state.gameOver = false;
    state.dealer = null;
    state.board = [];
    state.toAct = null;
    state.sbSeat = null;
    state.bbSeat = null;
    state.winners = [];
    state.revealed = false;
    for (let i = 0; i < players.length; i++) {
      players[i].stack = START_STACK;
      players[i].rebuys = 0;
      players[i].out = false;
      players[i].bet = 0;
      players[i].committed = 0;
      players[i].folded = false;
      players[i].allIn = false;
      players[i].cards = [];
      players[i].lastAction = "";
      players[i].talk = "";
      players[i].talkHistory = [];
    }
    state.log = ["\u724C\u684C\u5DF2\u91CD\u7F6E\u3002\u70B9\u51FB\u300C\u5F00\u59CB\u5BF9\u5C40\u300D\u3002"];
    state.timeline = [];
    state.actionLog = [];
    return snapshot();
  }
  function act(args, seat) {
    const at = Number.isInteger(seat) ? seat : 0;
    const type = args && typeof args.type === "string" ? args.type : "";
    if (state.status !== "playing" || state.toAct !== at) return snapshot(at);
    const p = players[at];
    if (!p) return snapshot(at);
    const who = p.seat === 0 ? "you" : p.name;
    applyAction(p, type, args && args.amount);
    state.actionLog = (state.actionLog || []).concat([state.street + ": " + who + " " + p.lastAction]).slice(-16);
    record({ kind: "action", name: who, emoji: p.emoji, playerId: p.id, action: p.lastAction });
    afterAction();
    scheduleAi();
    return snapshot(at);
  }
  function setAvatar(args) {
    const id = args && args.id;
    if (!isPlayerId(id)) throw new Error("unknown player");
    const decoded = decodeAvatar(args);
    if (!decoded) throw new Error("invalid image");
    overrides[id] = writeOverride(avatarDir, id, decoded);
    return snapshot();
  }
  function clearAvatar(args) {
    const id = args && args.id;
    if (!isPlayerId(id)) throw new Error("unknown player");
    removeOverride(avatarDir, id);
    delete overrides[id];
    return snapshot();
  }
  function avatarFile(id) {
    if (overrides[id]) return overrides[id];
    return bundled[id] || null;
  }
  function playerCount() {
    return players.length;
  }
  function availableSeats() {
    return players.filter(function(p) {
      return p.seat > 0 && p.kind === "ai" && !p.out;
    }).map(function(p) {
      return p.seat;
    });
  }
  function claimSeat(seat) {
    const p = players[seat];
    if (!p || p.seat === 0 || p.kind === "guest") return false;
    p.kind = "guest";
    p.remote = true;
    if (state.toAct === seat) state.thinkEndsAt = 0;
    return true;
  }
  function releaseSeat(seat) {
    const p = players[seat];
    if (!p || p.seat === 0 || p.kind !== "guest") return false;
    p.kind = "ai";
    p.remote = false;
    if (state.status === "playing" && state.toAct === seat) scheduleAi();
    return true;
  }
  function status() {
    return state.status;
  }
  function handNo() {
    return state.handNo;
  }
  function dispose() {
    clearAi();
  }
  if (!options || options.registerEffect !== false) {
    ctx.effect(function() {
      return dispose;
    });
  }
  return {
    snapshot,
    start,
    nextHand,
    reset,
    act,
    setAvatar,
    clearAvatar,
    avatarFile,
    dispose,
    // LAN surface
    playerCount,
    availableSeats,
    claimSeat,
    releaseSeat,
    status,
    handNo
  };
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
};
function requestHeader(req, name2) {
  const value = req && req.headers && req.headers[name2];
  if (Array.isArray(value)) return value.join(",");
  return typeof value === "string" ? value : "";
}
function discardRequest(req) {
  if (req && !req.readableEnded && typeof req.resume === "function") req.resume();
}
function requestContentLength(req) {
  const raw = requestHeader(req, "content-length").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, "invalid content-length");
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new HttpError(400, "invalid content-length");
  return length;
}
function readJson2(req, maxBytes) {
  const limit = maxBytes == null ? MAX_REQUEST_BYTES : maxBytes;
  const mediaType = requestHeader(req, "content-type").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    discardRequest(req);
    return Promise.reject(new HttpError(415, "content-type must be application/json"));
  }
  let declaredLength;
  try {
    declaredLength = requestContentLength(req);
  } catch (err) {
    discardRequest(req);
    return Promise.reject(err);
  }
  if (declaredLength != null && declaredLength > limit) {
    discardRequest(req);
    return Promise.reject(new HttpError(413, "request body too large"));
  }
  return new Promise(function(resolve, reject) {
    const chunks = [];
    let total = 0;
    let settled = false;
    const timeout = setTimeout(function() {
      fail(new HttpError(408, "request body timeout"));
    }, REQUEST_BODY_TIMEOUT_MS);
    if (typeof timeout.unref === "function") timeout.unref();
    function cleanup() {
      clearTimeout(timeout);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      req.removeListener("close", onClose);
    }
    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      discardRequest(req);
      reject(err);
    }
    function onData(chunk) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += part.length;
      if (total > limit) {
        fail(new HttpError(413, "request body too large"));
        return;
      }
      chunks.push(part);
    }
    function onEnd() {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (declaredLength != null && total !== declaredLength) {
          throw new HttpError(400, "content-length mismatch");
        }
        const raw = Buffer.concat(chunks, total).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    }
    function onError(err) {
      fail(err);
    }
    function onAborted() {
      fail(new HttpError(400, "request aborted"));
    }
    function onClose() {
      if (!req.readableEnded) fail(new HttpError(400, "request closed"));
    }
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
  });
}
function sendJson2(res, status, body, extraHeaders) {
  const data = Buffer.from(JSON.stringify(body));
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(data.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(data);
}
function sendBytes(res, mime, bytes, extraHeaders) {
  const headers = {
    "content-type": mime || "application/octet-stream",
    "content-length": String(bytes.length),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(200, headers);
  res.end(bytes);
}
function methodFromUrl(url) {
  const path = String(url || "").split("?")[0];
  const rest = path.replace(/^\/dsh-poker-night\/?/, "");
  return rest || "get-state";
}
function queryParam(url, name2) {
  const at = String(url || "").indexOf("?");
  if (at < 0) return "";
  const parts = String(url).slice(at + 1).split("&");
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0 || parts[i].slice(0, eq) !== name2) continue;
    try {
      return decodeURIComponent(parts[i].slice(eq + 1));
    } catch (err) {
      return "";
    }
  }
  return "";
}
function cookieValue(req) {
  const raw = requestHeader(req, "cookie");
  const parts = raw ? raw.split(";") : [];
  for (let i = 0; i < parts.length; i++) {
    const at = parts[i].indexOf("=");
    if (at < 0) continue;
    if (parts[i].slice(0, at).trim() === SESSION_COOKIE) return parts[i].slice(at + 1).trim();
  }
  return "";
}
function sessionToken(req) {
  const header = requestHeader(req, SESSION_HEADER).trim();
  if (header) return header;
  return cookieValue(req);
}
function requestIsSecure(req) {
  const forwarded = requestHeader(req, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
  if (forwarded === "https") return true;
  return !!(req && req.socket && req.socket.encrypted);
}
function sessionCookie(req, id) {
  const parts = [
    SESSION_COOKIE + "=" + id,
    "Path=/dsh-poker-night",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + Math.floor(SESSION_TTL_MS / 1e3)
  ];
  if (requestIsSecure(req)) parts.push("Secure");
  return parts.join("; ");
}
function sameSecret(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function requestOrigin(req) {
  const forwarded = requestHeader(req, "x-forwarded-proto").split(",")[0].trim().toLowerCase();
  const protocol = forwarded === "https" || forwarded === "http" ? forwarded : req && req.socket && req.socket.encrypted ? "https" : "http";
  const host = requestHeader(req, "host").trim();
  if (!host) return "";
  try {
    return new URL(protocol + "://" + host).origin;
  } catch (err) {
    return "";
  }
}
function validateCsrf(req, session) {
  const token = requestHeader(req, "x-csrf-token").trim();
  if (!sameSecret(token, session && session.csrfToken)) throw new HttpError(403, "csrf validation failed");
}
function httpOrigin(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch (err) {
    return "";
  }
}
function validateOrigin(req) {
  const expected = requestOrigin(req);
  const origin = requestHeader(req, "origin").trim();
  if (origin) {
    let actual = "";
    try {
      if (origin !== "null") actual = new URL(origin).origin;
    } catch (err) {
    }
    if (!expected || actual !== expected) throw new HttpError(403, "cross-origin request rejected");
  } else {
    const actual = httpOrigin(requestHeader(req, "referer").trim());
    if (actual && (!expected || actual !== expected)) throw new HttpError(403, "cross-origin request rejected");
  }
  if (requestHeader(req, "sec-fetch-site").trim().toLowerCase() === "cross-site") {
    throw new HttpError(403, "cross-origin request rejected");
  }
}
function errorStatus(err) {
  if (err instanceof HttpError) return err.status;
  if (err instanceof SyntaxError || /unknown player|invalid image/.test(String(err && err.message || err))) return 400;
  return 500;
}
var name = "dsh-poker-night";
var inject = ["timer", "webServer"];
function apply(ctx) {
  const sessions = /* @__PURE__ */ new Map();
  function disposeSession(session) {
    const st = lanState.get(session);
    if (st) {
      lanState.delete(session);
      stopLan(st, true).catch(function() {
      });
    }
    if (!session || !session.table || typeof session.table.dispose !== "function") return;
    session.table.dispose();
  }
  function removeSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    disposeSession(session);
  }
  function pruneSessions(now) {
    for (const [id, session] of sessions) {
      if (now - session.lastUsed > SESSION_TTL_MS) removeSession(id);
    }
  }
  function findSession(req) {
    const id = sessionToken(req);
    if (!id) return null;
    const session = sessions.get(id);
    if (!session) return null;
    const now = Date.now();
    if (now - session.lastUsed > SESSION_TTL_MS) {
      removeSession(id);
      return null;
    }
    session.lastUsed = now;
    return session;
  }
  function findSessionByMediaToken(token) {
    if (!token) return null;
    for (const session of sessions.values()) {
      if (!sameSecret(token, session.mediaToken)) continue;
      const now = Date.now();
      if (now - session.lastUsed > SESSION_TTL_MS) {
        removeSession(session.id);
        return null;
      }
      session.lastUsed = now;
      return session;
    }
    return null;
  }
  function createSession(req) {
    const now = Date.now();
    pruneSessions(now);
    if (sessions.size >= MAX_SESSIONS) throw new HttpError(503, "too many active sessions");
    let id;
    do {
      id = randomBytes2(32).toString("base64url");
    } while (sessions.has(id));
    const mediaToken = randomBytes2(24).toString("base64url");
    const session = {
      id,
      csrfToken: randomBytes2(32).toString("base64url"),
      mediaToken,
      table: createTable(ctx, { registerEffect: false, mediaToken }),
      lastUsed: now
    };
    sessions.set(id, session);
    return session;
  }
  function requireSession(req) {
    const session = findSession(req);
    if (!session) throw new HttpError(401, "session required");
    return session;
  }
  function addSessionHeaders(headers, session, setCookie) {
    if (session) {
      headers["x-csrf-token"] = session.csrfToken;
      headers[SESSION_HEADER] = session.id;
    }
    if (setCookie) headers["set-cookie"] = [setCookie];
    return headers;
  }
  const lanState = /* @__PURE__ */ new WeakMap();
  function lanFor(session) {
    let st = lanState.get(session);
    if (!st) {
      st = { room: null, discovery: null, peers: [], timer: null, proxy: null, error: "", addresses: [] };
      lanState.set(session, st);
    }
    return st;
  }
  function lanView(st) {
    const now = Date.now();
    st.peers = prunePeers(st.peers, now);
    const room = st.room ? st.room.info() : null;
    return {
      enabled: !!room,
      code: room ? room.code : "",
      port: room ? room.port : 0,
      discovery: st.discovery ? st.discovery.bound ? "udp" : "degraded" : "",
      addresses: st.addresses.slice(),
      peers: st.peers.map(function(p) {
        return { name: p.name, host: p.host, port: p.port, players: p.players, status: p.status };
      }),
      joined: st.proxy ? { host: st.proxy.host, port: st.proxy.port, seat: st.proxy.seat, name: st.proxy.name } : null,
      error: st.error || (st.proxy ? st.proxy.error : "") || ""
    };
  }
  function withLan(session, snap) {
    return Object.assign({}, snap, { lan: lanView(lanFor(session)) });
  }
  function viewFor(session) {
    const st = lanState.get(session);
    if (st && st.proxy && st.proxy.snap) return withLan(session, st.proxy.snap);
    return withLan(session, session.table.snapshot(0));
  }
  async function stopLan(st, notifyRemote) {
    if (st.timer) {
      clearInterval(st.timer);
      st.timer = null;
    }
    if (st.discovery) {
      const discovery = st.discovery;
      st.discovery = null;
      await discovery.close();
    }
    if (st.room) {
      const room = st.room;
      st.room = null;
      await room.stop();
    }
    if (st.proxy) {
      const proxy = st.proxy;
      st.proxy = null;
      if (notifyRemote !== false) {
        try {
          await remoteLeave(proxy.host, proxy.port, proxy.ticket, 1500);
        } catch (e) {
        }
      }
    }
    st.peers = [];
    return st;
  }
  async function lanEnable(st, session, args) {
    if (st.room) return;
    const code = makeRoomCode();
    const wanted = Number(args && args.port) > 0 ? Number(args.port) : DEFAULT_ROOM_PORT;
    const room = createRoom({
      table: session.table,
      name: args && typeof args.name === "string" && args.name || "\u724C\u684C",
      code,
      port: wanted
    });
    try {
      await room.start();
    } catch (err) {
      st.error = "\u7AEF\u53E3 " + wanted + " \u88AB\u5360\u7528\uFF0C\u6362\u4E2A\u7AEF\u53E3\u518D\u8BD5";
      return;
    }
    st.room = room;
    st.addresses = localAddresses();
    const discovery = createDiscovery({
      // Our own broadcasts come back on the loopback address; the room id keeps
      // them out of the peer list without exposing the room code.
      selfId: room.info().id,
      onPeer: function(info, rinfo) {
        const host = rinfo && rinfo.address || "";
        st.peers = st.peers.filter(function(p) {
          return !(p.host === host && p.port === info.port);
        });
        st.peers.push({
          name: info.name,
          host,
          port: info.port,
          players: info.players,
          status: info.status,
          seenAt: Date.now()
        });
      }
    });
    st.discovery = discovery;
    await discovery.bind();
    const announce = function() {
      if (!st.room || !st.discovery) return;
      st.discovery.announce(st.room.info());
    };
    announce();
    st.timer = setInterval(announce, BROADCAST_INTERVAL_MS);
  }
  async function lanJoin(st, args) {
    const host = String(args && args.host || "").trim();
    const port = Number(args && args.port);
    const code = normalizeRoomCode(args && args.code);
    if (!host || !Number.isInteger(port) || port <= 0 || !code) {
      throw new HttpError(400, "\u9700\u8981\u4E3B\u673A\u5730\u5740\u3001\u7AEF\u53E3\u548C 6 \u4F4D\u623F\u95F4\u53F7");
    }
    const joined = await remoteJoin(host, port, code, "\u8FDC\u7A0B\u73A9\u5BB6");
    st.proxy = {
      host,
      port,
      ticket: joined.ticket,
      seat: joined.seat,
      name: joined.room && joined.room.name || "\u8FDC\u7A0B\u724C\u684C",
      snap: null,
      error: ""
    };
    const poll = async function() {
      const proxy = st.proxy;
      if (!proxy) return;
      try {
        const res = await remoteState(proxy.host, proxy.port, proxy.ticket, 3e3);
        proxy.snap = res.state;
        proxy.seat = res.seat;
        proxy.error = "";
      } catch (err) {
        proxy.error = "\u4E0E\u4E3B\u673A\u5931\u53BB\u8054\u7CFB\uFF1A" + String(err && err.message || err);
      }
    };
    await poll();
    if (st.timer) clearInterval(st.timer);
    st.timer = setInterval(poll, LAN_POLL_MS);
  }
  async function lanMethod(session, args) {
    const st = lanFor(session);
    const mode = String(args && args.mode || "");
    st.error = "";
    if (mode === "enable") await lanEnable(st, session, args || {});
    else if (mode === "disable") await stopLan(st, true);
    else if (mode === "scan") {
      if (st.room && st.discovery) st.discovery.announce(st.room.info());
    } else if (mode === "join") await lanJoin(st, args || {});
    else if (mode === "leave") await stopLan(st, true);
    else throw new HttpError(400, "unknown lan mode");
    return viewFor(session);
  }
  ctx.effect(function() {
    return function() {
      for (const session of sessions.values()) disposeSession(session);
      sessions.clear();
    };
  });
  ctx.effect(function() {
    return ctx.webServer.register({
      kind: "prefix",
      path: "/dsh-poker-night",
      handler: async function(req, res) {
        const method = methodFromUrl(req.url);
        let session = null;
        let setCookie = "";
        const responseHeaders = {};
        const json = function(status, body) {
          sendJson2(res, status, body, addSessionHeaders(responseHeaders, session, setCookie));
        };
        const bytes = function(mime, data) {
          sendBytes(res, mime, data, addSessionHeaders(responseHeaders, session, ""));
        };
        try {
          if (req.method === "GET" && method.indexOf("avatar/") === 0) {
            discardRequest(req);
            validateOrigin(req);
            const owner = findSession(req) || findSessionByMediaToken(queryParam(req.url, MEDIA_PARAM));
            if (!owner) throw new HttpError(401, "session required");
            const id = decodeURIComponent(method.slice("avatar/".length).split("/")[0]);
            const file = owner.table.avatarFile(id);
            if (!file) {
              json(404, { error: "no override" });
              return;
            }
            bytes(file.mime, file.bytes);
            return;
          }
          if (req.method === "GET") {
            validateOrigin(req);
            discardRequest(req);
            session = findSession(req);
            if (!session) {
              session = createSession(req);
              setCookie = sessionCookie(req, session.id);
            }
            json(200, viewFor(session));
            return;
          }
          if (req.method !== "POST") {
            discardRequest(req);
            json(405, { error: "method not allowed" });
            return;
          }
          if (MUTATING_METHODS.indexOf(method) === -1) {
            discardRequest(req);
            json(404, { error: "unknown method" });
            return;
          }
          session = requireSession(req);
          addSessionHeaders(responseHeaders, session, "");
          validateCsrf(req, session);
          validateOrigin(req);
          const args = await readJson2(req, MAX_REQUEST_BYTES);
          const body = args || {};
          const st = lanState.get(session);
          if (method === "lan") {
            json(200, await lanMethod(session, body));
          } else if (st && st.proxy) {
            if (method === "act") {
              const remote = await remoteAct(st.proxy.host, st.proxy.port, st.proxy.ticket, body);
              if (remote && remote.state) st.proxy.snap = remote.state;
              json(200, viewFor(session));
            } else {
              json(409, { error: "\u5DF2\u52A0\u5165\u8FDC\u7A0B\u724C\u684C\uFF0C\u8BF7\u5148\u79BB\u5F00\u518D\u64CD\u4F5C\u672C\u5730\u724C\u684C" });
            }
          } else if (method === "start") json(200, withLan(session, session.table.start()));
          else if (method === "act") json(200, withLan(session, session.table.act(body)));
          else if (method === "next-hand") json(200, withLan(session, session.table.nextHand()));
          else if (method === "reset") json(200, withLan(session, session.table.reset()));
          else if (method === "set-avatar") json(200, withLan(session, session.table.setAvatar(body)));
          else if (method === "clear-avatar") json(200, withLan(session, session.table.clearAvatar(body)));
        } catch (err) {
          discardRequest(req);
          if (res.headersSent) {
            if (typeof res.destroy === "function") res.destroy();
            return;
          }
          const status = errorStatus(err);
          if (status === 408 || status === 413) responseHeaders.connection = "close";
          const message = status >= 500 ? "internal server error" : String(err && err.message || err);
          json(status, { error: message });
        }
      }
    });
  });
}
export {
  apply,
  createTable,
  inject,
  name
};
