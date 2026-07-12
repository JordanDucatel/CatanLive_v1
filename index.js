const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5001

const app = express()
const clients = new Set()
const players = []
let nextPlayerId = 1

function getState() {
  return {
    players: players.slice(0, 4).map((player) => ({
      id: player.id,
      name: player.name,
      count: player.count
    })),
    maxPlayers: 4
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
      count: 0
    }

    players.push(player)
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
    broadcastState()

    return res.json({ state: getState() })
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
