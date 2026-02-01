# Coin Snake - Multiplayer Server

A high-performance WebSocket game server for Coin Snake.

## Quick Start

```bash
# No dependencies needed! Uses only Node.js built-in modules
node server.js
```

Or with a custom port:
```bash
PORT=8080 node server.js
```

## Features

- 🎮 60Hz physics tick rate, 20Hz network updates
- 🏆 5 buy-in tier rooms (1000¢, 5000¢, 10000¢, 50000¢, 100000¢)
- 🐍 Full snake.io-style mechanics
- ⚡ Efficient state compression (only sends visible entities)
- 🔄 No external dependencies - pure Node.js

## API

### HTTP Endpoints

- `GET /info` - Server status and room info

### WebSocket Messages

**Client → Server:**
```json
{ "type": "join", "nickname": "Player1", "color": "#f7931a", "buyIn": 10000 }
{ "type": "input", "angle": 1.57, "boost": false }
{ "type": "cashout" }
{ "type": "ping", "time": 1234567890 }
```

**Server → Client:**
```json
{ "type": "joined", "playerId": "...", "nickname": "...", "buyIn": 10000 }
{ "type": "state", "players": [...], "orbs": [...], "leaderboard": [...] }
{ "type": "death", "killer": "Player2", "score": 5000, "profit": -5000 }
{ "type": "cashout_result", "score": 15000, "profit": 5000, "success": true }
{ "type": "pong", "time": 1234567890 }
```

## Configuration

Edit the constants at the top of `server.js`:

```javascript
const PORT = 3001;
const TICK_RATE = 60;      // Physics updates per second
const SEND_RATE = 20;      // Network updates per second
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
```
