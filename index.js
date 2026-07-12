const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5001

const app = express()
const clients = new Set()
const players = []
const colors = ['#2563eb', '#16a34a', '#ea580c', '#dc2626']
const dicePool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
const eventLog = []
const resourceTypes = [
  { name: 'Sheep', color: '#86efac' },
  { name: 'Wheat', color: '#facc15' },
  { name: 'Ore', color: '#9ca3af' },
  { name: 'Wood', color: '#15803d' },
  { name: 'Brick', color: '#b45309' }
]

let nextPlayerId = 1
let lastRoll = null
let lastRollBy = null
let setupMode = false
let boardResource = null
let boardPip = null

function addEvent(message) {
  eventLog.push(message)
  if (eventLog.length > 30) {
    eventLog.shift()
  }
}

function resolvePlayer(playerId, providedName) {
  const player = players.find((entry) => entry.id === playerId)

  if (!player) {
    return null
  }

  const displayName = (providedName || player.name || '').trim()

  return {
    player,
    displayName: displayName || player.name
  }
}

function resetGameState() {
  players.splice(0, players.length)
  eventLog.splice(0, eventLog.length)
  lastRoll = null
  lastRollBy = null
  setupMode = false
  boardResource = null
  boardPip = null
  nextPlayerId = 1
}

function getState() {
  return {
    players: players.slice(0, 4).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      count: player.count,
      settlements: player.settlements,
      roads: player.roads,
      cities: player.cities
    })),
    maxPlayers: 4,
    eventLog: eventLog.slice(-30),
    lastRoll,
    lastRollBy,
    setupMode,
    boardResource,
    boardPip,
    reset: false
  }
}

function broadcastState() {
  const payload = JSON.stringify(getState())
  for (const client of clients) {
    client.write(`event: state\ndata: ${payload}\n\n`)
  }
}

app
  .use(express.json())
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.render('pages/index', {
    title: 'CatanLive_v1',
    message: 'Welcome to CatanLive',
    initialState: getState()
  }))
  .get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    clients.add(res)
    res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`)

    req.on('close', () => {
      clients.delete(res)
    })
  })
  .post('/join', (req, res) => {
    const name = (req.body?.name || '').trim()

    if (!name) {
      return res.status(400).json({ error: 'A player name is required.' })
    }

    if (players.length >= 4) {
      return res.status(409).json({ error: 'The game already has 4 players.' })
    }

    const player = {
      id: nextPlayerId++,
      name,
      color: colors[players.length],
      count: 0,
      settlements: 5,
      roads: 15,
      cities: 4
    }

    players.push(player)
    addEvent(`${player.name} joined the game.`)
    broadcastState()

    return res.json({ playerId: player.id, name: player.name, state: getState() })
  })
  .post('/resume', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const name = (req.body?.name || '').trim()

    if (!playerId || !name) {
      return res.status(400).json({ error: 'A player identity is required.' })
    }

    const player = players.find((entry) => entry.id === playerId && entry.name === name) || players.find((entry) => entry.name === name)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.', canJoin: true })
    }

    return res.json({ playerId: player.id, name: player.name, state: getState() })
  })
  .post('/count', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved
    player.count += 1
    addEvent(`${displayName} pressed Count.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/roll-dice', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved
    const roll = dicePool[Math.floor(Math.random() * dicePool.length)]
    lastRoll = roll
    lastRollBy = displayName
    addEvent(`${displayName} rolled a ${roll}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-road', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved

    if (player.roads <= 0) {
      return res.status(400).json({ error: 'You do not have any roads left.' })
    }

    player.roads -= 1
    addEvent(`${displayName} placed a road.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-settlement', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved

    if (player.settlements <= 0) {
      return res.status(400).json({ error: 'You do not have any settlements left.' })
    }

    player.settlements -= 1
    addEvent(`${displayName} placed a settlement.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-city', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved

    if (player.cities <= 0) {
      return res.status(400).json({ error: 'You do not have any cities left.' })
    }

    player.cities -= 1
    addEvent(`${displayName} placed a city.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/random-tile', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { displayName } = resolved

    if (!setupMode) {
      return res.status(400).json({ error: 'Setup mode is disabled.' })
    }

    const resource = resourceTypes[Math.floor(Math.random() * resourceTypes.length)]
    boardResource = resource.name
    boardPip = boardPip || null
    addEvent(`${displayName} randomized the tile to ${resource.name}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/random-pips', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { displayName } = resolved

    if (!setupMode) {
      return res.status(400).json({ error: 'Setup mode is disabled.' })
    }

    boardPip = dicePool[Math.floor(Math.random() * dicePool.length)]
    addEvent(`${displayName} randomized the pip value to ${boardPip}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/toggle-setup', (req, res) => {
    setupMode = Boolean(req.body?.enabled)
    addEvent(setupMode ? 'Setup mode enabled.' : 'Setup mode disabled.')
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/reset-game', (req, res) => {
    resetGameState()
    addEvent('The board was flipped and the game was reset.')
    broadcastState()

    return res.json({ state: getState(), reset: true })
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
