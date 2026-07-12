const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5001

const app = express()
const clients = new Set()
const players = []
const colors = ['#2563eb', '#16a34a', '#ea580c', '#dc2626']
const dicePool = [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 11, 11, 12]
const eventLog = []
let nextPlayerId = 1
let lastRoll = null
let lastRollBy = null

function addEvent(message) {
  eventLog.push(message)
  if (eventLog.length > 12) {
    eventLog.shift()
  }
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
    eventLog: eventLog.slice(-12),
    lastRoll,
    lastRollBy
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
  .post('/count', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const player = players.find((entry) => entry.id === playerId)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    player.count += 1
    addEvent(`${player.name} pressed Count.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/roll-dice', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const player = players.find((entry) => entry.id === playerId)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const roll = dicePool[Math.floor(Math.random() * dicePool.length)]
    lastRoll = roll
    lastRollBy = player.name
    addEvent(`${player.name} rolled a ${roll}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-road', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const player = players.find((entry) => entry.id === playerId)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (player.roads <= 0) {
      return res.status(400).json({ error: 'You do not have any roads left.' })
    }

    player.roads -= 1
    addEvent(`${player.name} placed a road.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-settlement', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const player = players.find((entry) => entry.id === playerId)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (player.settlements <= 0) {
      return res.status(400).json({ error: 'You do not have any settlements left.' })
    }

    player.settlements -= 1
    addEvent(`${player.name} placed a settlement.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/build-city', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const player = players.find((entry) => entry.id === playerId)

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (player.cities <= 0) {
      return res.status(400).json({ error: 'You do not have any cities left.' })
    }

    player.cities -= 1
    addEvent(`${player.name} placed a city.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
