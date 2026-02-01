/**
 * Coin Snake - High Performance Multiplayer Server
 * Using Node.js built-in modules only (no external dependencies)
 *
 * Run: node server.js
 */

const http = require('http');
const crypto = require('crypto');

// Server config
const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const SEND_RATE = 20;
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const SNAKE_SPEED = 2.5;
const BOOST_SPEED = 5;
const ORB_VALUE = 50;
const INITIAL_SNAKE_LENGTH = 15;
const SEGMENT_SPACING = 5;
const TURN_SPEED = 0.12;
const MAX_ORBS = 300;

const BUY_IN_TIERS = [1000, 5000, 10000, 50000, 100000];

const ADJECTIVES = ['Swift', 'Sneaky', 'Golden', 'Crypto', 'Diamond', 'Lucky', 'Savage', 'Silent', 'Thunder', 'Shadow', 'Blazing', 'Frost', 'Neon', 'Cosmic', 'Rapid'];
const NOUNS = ['Snake', 'Viper', 'Cobra', 'Python', 'Serpent', 'Mamba', 'Boa', 'Asp', 'Rattler', 'Adder', 'Slither', 'Coil', 'Fang', 'Scale', 'Striker'];

function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 99);
  return `${adj}${noun}${num}`;
}

function randomColor() {
  const colors = ['#f7931a', '#4ade80', '#60a5fa', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#f87171', '#fbbf24', '#a3e635'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Simple WebSocket implementation using built-in modules
class WebSocketServer {
  constructor(server) {
    this.clients = new Set();

    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });
  }

  handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(responseHeaders);

    const client = new WebSocketClient(socket);
    this.clients.add(client);

    client.on('close', () => {
      this.clients.delete(client);
    });

    if (this.onconnection) {
      this.onconnection(client, req);
    }
  }
}

class WebSocketClient {
  constructor(socket) {
    this.socket = socket;
    this.readyState = 1; // OPEN
    this.handlers = {};
    this.buffer = Buffer.alloc(0);

    socket.on('data', (data) => this.handleData(data));
    socket.on('close', () => this.handleClose());
    socket.on('error', (err) => this.emit('error', err));
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  emit(event, ...args) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(...args));
    }
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const opcode = firstByte & 0x0F;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7F;

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskOffset = offset;
      if (isMasked) offset += 4;

      const totalLength = offset + payloadLength;
      if (this.buffer.length < totalLength) return;

      let payload = this.buffer.slice(offset, totalLength);

      if (isMasked) {
        const mask = this.buffer.slice(maskOffset, maskOffset + 4);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      this.buffer = this.buffer.slice(totalLength);

      if (opcode === 0x08) {
        this.close();
        return;
      } else if (opcode === 0x09) {
        this.pong(payload);
      } else if (opcode === 0x0A) {
        // Pong received
      } else if (opcode === 0x01) {
        const message = payload.toString('utf8');
        this.emit('message', message);
      }
    }
  }

  send(data) {
    if (this.readyState !== 1) return;

    const payload = Buffer.from(data, 'utf8');
    const length = payload.length;

    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      this.close();
    }
  }

  pong(data) {
    const frame = Buffer.alloc(2 + data.length);
    frame[0] = 0x8A;
    frame[1] = data.length;
    data.copy(frame, 2);
    try {
      this.socket.write(frame);
    } catch (e) {}
  }

  ping() {
    const frame = Buffer.from([0x89, 0x00]);
    try {
      this.socket.write(frame);
    } catch (e) {}
  }

  close() {
    if (this.readyState === 1) {
      this.readyState = 3;
      try {
        this.socket.write(Buffer.from([0x88, 0x00]));
        this.socket.end();
      } catch (e) {}
      this.emit('close');
    }
  }

  handleClose() {
    if (this.readyState !== 3) {
      this.readyState = 3;
      this.emit('close');
    }
  }

  terminate() {
    this.readyState = 3;
    try {
      this.socket.destroy();
    } catch (e) {}
    this.emit('close');
  }
}

// Game Room class
class GameRoom {
  constructor(buyInAmount) {
    this.buyInAmount = buyInAmount;
    this.players = new Map();
    this.orbs = [];
    this.lastUpdate = Date.now();
    this.tickInterval = null;
    this.sendInterval = null;
    this.spawnInitialOrbs();
  }

  spawnInitialOrbs() {
    for (let i = 0; i < 200; i++) {
      this.orbs.push(this.createOrb());
    }
  }

  createOrb(x, y, value = ORB_VALUE, isDeathOrb = false) {
    return {
      id: Date.now() + Math.random(),
      x: x ?? Math.random() * (WORLD_WIDTH - 100) + 50,
      y: y ?? Math.random() * (WORLD_HEIGHT - 100) + 50,
      value: value,
      size: 6 + Math.random() * 4,
      isDeathOrb
    };
  }

  addPlayer(ws, nickname, color) {
    const id = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const centerX = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 500;
    const centerY = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 500;
    const angle = Math.random() * Math.PI * 2;

    const segments = [];
    for (let i = 0; i < INITIAL_SNAKE_LENGTH; i++) {
      segments.push({
        x: centerX - Math.cos(angle) * i * SEGMENT_SPACING,
        y: centerY - Math.sin(angle) * i * SEGMENT_SPACING
      });
    }

    const player = {
      id,
      ws,
      nickname,
      color,
      segments,
      angle,
      targetAngle: angle,
      score: 0,
      isBoosting: false,
      isAlive: true,
      lastInput: Date.now(),
      buyIn: this.buyInAmount
    };

    this.players.set(ws, player);

    if (this.players.size === 1) {
      this.startGameLoop();
    }

    return player;
  }

  removePlayer(ws) {
    const player = this.players.get(ws);
    if (player && player.isAlive) {
      this.dropPlayerOrbs(player);
    }
    this.players.delete(ws);

    if (this.players.size === 0) {
      this.stopGameLoop();
    }
  }

  dropPlayerOrbs(player) {
    const orbsToDrop = Math.min(player.segments.length, Math.floor(player.score / ORB_VALUE) + 5);
    for (let i = 0; i < orbsToDrop && i < player.segments.length; i++) {
      this.orbs.push(this.createOrb(
        player.segments[i].x + (Math.random() - 0.5) * 30,
        player.segments[i].y + (Math.random() - 0.5) * 30,
        ORB_VALUE,
        true
      ));
    }
  }

  handleInput(ws, input) {
    const player = this.players.get(ws);
    if (!player || !player.isAlive) return;

    player.targetAngle = input.angle;
    player.isBoosting = input.boost && player.segments.length > 5;
    player.lastInput = Date.now();
  }

  handleCashOut(ws) {
    const player = this.players.get(ws);
    if (!player || !player.isAlive) return null;

    player.isAlive = false;
    const profit = player.score - this.buyInAmount;

    return {
      playerId: player.id,
      score: player.score,
      buyIn: this.buyInAmount,
      profit,
      success: profit >= 0
    };
  }

  startGameLoop() {
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.sendInterval = setInterval(() => this.broadcastState(), 1000 / SEND_RATE);
  }

  stopGameLoop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.sendInterval) clearInterval(this.sendInterval);
  }

  tick() {
    const now = Date.now();
    this.lastUpdate = now;

    for (const [ws, player] of this.players) {
      if (!player.isAlive) continue;

      // Smooth turning
      let angleDiff = player.targetAngle - player.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      player.angle += angleDiff * TURN_SPEED;

      const speed = player.isBoosting ? BOOST_SPEED : SNAKE_SPEED;
      const head = player.segments[0];
      const newHead = {
        x: head.x + Math.cos(player.angle) * speed,
        y: head.y + Math.sin(player.angle) * speed
      };

      // World boundaries
      newHead.x = Math.max(20, Math.min(WORLD_WIDTH - 20, newHead.x));
      newHead.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, newHead.y));

      player.segments.unshift(newHead);
      player.segments.pop();

      // Boost drain
      if (player.isBoosting && player.segments.length > 5) {
        const tail = player.segments.pop();
        this.orbs.push(this.createOrb(tail.x, tail.y, ORB_VALUE / 2));
        player.score = Math.max(0, player.score - ORB_VALUE / 2);
      }

      // Orb collection
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const orb = this.orbs[i];
        const dx = head.x - orb.x;
        const dy = head.y - orb.y;
        if (Math.sqrt(dx * dx + dy * dy) < orb.size + 12) {
          player.score += orb.value;
          player.segments.push({ ...player.segments[player.segments.length - 1] });
          this.orbs.splice(i, 1);
        }
      }
    }

    // Player collisions
    const playersArray = Array.from(this.players.values()).filter(p => p.isAlive);
    for (const player of playersArray) {
      const head = player.segments[0];

      for (const other of playersArray) {
        if (player.id === other.id) continue;

        for (let i = 5; i < other.segments.length; i++) {
          const seg = other.segments[i];
          const dx = head.x - seg.x;
          const dy = head.y - seg.y;
          if (Math.sqrt(dx * dx + dy * dy) < 12) {
            player.isAlive = false;
            this.dropPlayerOrbs(player);

            if (player.ws && player.ws.readyState === 1) {
              player.ws.send(JSON.stringify({
                type: 'death',
                killer: other.nickname,
                score: player.score,
                buyIn: this.buyInAmount,
                profit: player.score - this.buyInAmount
              }));
            }
            break;
          }
        }
        if (!player.isAlive) break;
      }
    }

    // Spawn orbs
    if (this.orbs.length < MAX_ORBS && Math.random() < 0.1) {
      this.orbs.push(this.createOrb());
    }
  }

  broadcastState() {
    const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);

    for (const [ws, player] of this.players) {
      if (ws.readyState !== 1) continue;
      if (!player.isAlive) continue;

      const head = player.segments[0];
      const viewRange = 600;

      const visiblePlayers = alivePlayers
        .filter(p => {
          if (p.id === player.id) return true;
          const dx = p.segments[0].x - head.x;
          const dy = p.segments[0].y - head.y;
          return Math.sqrt(dx * dx + dy * dy) < viewRange + 200;
        })
        .map(p => ({
          id: p.id,
          n: p.nickname,
          c: p.color,
          s: p.segments.map(seg => [Math.round(seg.x), Math.round(seg.y)]),
          a: Math.round(p.angle * 100) / 100,
          sc: p.score,
          b: p.isBoosting,
          me: p.id === player.id
        }));

      const visibleOrbs = this.orbs
        .filter(o => {
          const dx = o.x - head.x;
          const dy = o.y - head.y;
          return Math.sqrt(dx * dx + dy * dy) < viewRange + 50;
        })
        .map(o => [Math.round(o.x), Math.round(o.y), Math.round(o.size), o.isDeathOrb ? 1 : 0]);

      const leaderboard = Array.from(this.players.values())
        .filter(p => p.isAlive)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => ({ n: p.nickname, s: p.score }));

      ws.send(JSON.stringify({
        type: 'state',
        players: visiblePlayers,
        orbs: visibleOrbs,
        leaderboard,
        playerCount: alivePlayers.length
      }));
    }
  }
}

// Server setup
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/info') {
    const roomInfo = {};
    for (const [tier, room] of rooms) {
      roomInfo[tier] = {
        players: room.players.size,
        orbs: room.orbs.length
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: roomInfo, tiers: BUY_IN_TIERS }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer(server);

// Game rooms
const rooms = new Map();
BUY_IN_TIERS.forEach(tier => {
  rooms.set(tier, new GameRoom(tier));
});

// Connection handling
wss.onconnection = (ws, req) => {
  let currentRoom = null;
  let playerNickname = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'join':
          const tier = msg.buyIn || 10000;
          const room = rooms.get(tier);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid buy-in tier' }));
            return;
          }

          const nickname = msg.nickname?.trim().substring(0, 20) || generateNickname();
          const color = msg.color || randomColor();

          currentRoom = room;
          playerNickname = nickname;

          const player = room.addPlayer(ws, nickname, color);

          ws.send(JSON.stringify({
            type: 'joined',
            playerId: player.id,
            nickname: player.nickname,
            color: player.color,
            buyIn: tier,
            worldSize: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
          }));
          break;

        case 'input':
          if (currentRoom) {
            currentRoom.handleInput(ws, {
              angle: msg.angle,
              boost: msg.boost
            });
          }
          break;

        case 'cashout':
          if (currentRoom) {
            const result = currentRoom.handleCashOut(ws);
            if (result) {
              ws.send(JSON.stringify({
                type: 'cashout_result',
                ...result
              }));
            }
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', time: msg.time }));
          break;
      }
    } catch (e) {
      console.error('Message error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.removePlayer(ws);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
};

server.listen(PORT, () => {
  console.log(`🐍 Coin Snake Server running on port ${PORT}`);
  console.log(`📊 Buy-in tiers: ${BUY_IN_TIERS.map(t => t + '¢').join(', ')}`);
  console.log(`🎮 Tick rate: ${TICK_RATE}Hz, Send rate: ${SEND_RATE}Hz`);
  console.log(`🌐 WebSocket endpoint: ws://localhost:${PORT}`);
});
