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
const developmentCardTypes = [
  { key: 'knights', name: 'Knight' },
  { key: 'victoryPoints', name: 'Victory Point' },
  { key: 'monopoly', name: 'Monopoly' },
  { key: 'roadBuilding', name: 'Road Building' },
  { key: 'yearOfPlenty', name: 'Year of Plenty' }
]
const bankResources = {
  Sheep: 19,
  Wheat: 19,
  Ore: 19,
  Wood: 19,
  Brick: 19
}
const bankDevelopmentCards = {
  knights: 14,
  victoryPoints: 5,
  monopoly: 2,
  roadBuilding: 2,
  yearOfPlenty: 2
}
const history = []

let nextPlayerId = 1
let lastRoll = null
let lastRollBy = null
let setupMode = true
let boardResource = null
let boardPip = null
let longestRoadPlayerId = null
let largestArmyPlayerId = null

function addEvent(message) {
  eventLog.push(message)
  if (eventLog.length > 30) {
    eventLog.shift()
  }
}

function createPlayer(name, id) {
  return {
    id,
    name,
    color: colors[players.length],
    count: 0,
    rolls: 0,
    settlements: 5,
    roads: 15,
    cities: 4,
    resources: {
      Sheep: 0,
      Wheat: 0,
      Ore: 0,
      Wood: 0,
      Brick: 0
    },
    developmentCards: {
      knights: 0,
      victoryPoints: 0,
      monopoly: 0,
      roadBuilding: 0,
      yearOfPlenty: 0
    },
    playedDevelopmentCards: {
      knights: 0,
      monopoly: 0,
      roadBuilding: 0,
      yearOfPlenty: 0
    }
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

function captureSnapshot() {
  return {
    players: players.map((player) => ({
      ...player,
      resources: { ...player.resources },
      developmentCards: { ...player.developmentCards },
      playedDevelopmentCards: { ...player.playedDevelopmentCards }
    })),
    eventLog: eventLog.slice(),
    nextPlayerId,
    lastRoll,
    lastRollBy,
    setupMode,
    boardResource,
    boardPip,
    longestRoadPlayerId,
    largestArmyPlayerId,
    bankResources: { ...bankResources },
    bankDevelopmentCards: { ...bankDevelopmentCards }
  }
}

function restoreSnapshot(snapshot) {
  players.splice(0, players.length, ...snapshot.players.map((player) => ({
    ...player,
    resources: { ...player.resources },
    developmentCards: { ...player.developmentCards },
    playedDevelopmentCards: { ...player.playedDevelopmentCards }
  })))
  eventLog.splice(0, eventLog.length, ...snapshot.eventLog)
  nextPlayerId = snapshot.nextPlayerId
  lastRoll = snapshot.lastRoll
  lastRollBy = snapshot.lastRollBy
  setupMode = snapshot.setupMode
  boardResource = snapshot.boardResource
  boardPip = snapshot.boardPip
  longestRoadPlayerId = snapshot.longestRoadPlayerId
  largestArmyPlayerId = snapshot.largestArmyPlayerId
  Object.keys(bankResources).forEach((resource) => {
    bankResources[resource] = snapshot.bankResources[resource]
  })
  Object.keys(bankDevelopmentCards).forEach((cardKey) => {
    bankDevelopmentCards[cardKey] = snapshot.bankDevelopmentCards[cardKey]
  })
}

function resetGameState() {
  players.splice(0, players.length)
  eventLog.splice(0, eventLog.length)
  lastRoll = null
  lastRollBy = null
  setupMode = true
  boardResource = null
  boardPip = null
  longestRoadPlayerId = null
  largestArmyPlayerId = null
  nextPlayerId = 1
  Object.keys(bankResources).forEach((resource) => {
    bankResources[resource] = 19
  })
  Object.keys(bankDevelopmentCards).forEach((cardKey) => {
    bankDevelopmentCards[cardKey] = cardKey === 'knights' ? 14 : cardKey === 'victoryPoints' ? 5 : 2
  })
}

function getState() {
  return {
    players: players.slice(0, 4).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      count: player.count,
      rolls: player.rolls,
      settlements: player.settlements,
      roads: player.roads,
      cities: player.cities,
      resources: { ...player.resources },
      developmentCards: { ...player.developmentCards },
      playedDevelopmentCards: { ...player.playedDevelopmentCards }
    })),
    maxPlayers: 4,
    eventLog: eventLog.slice(-30),
    lastRoll,
    lastRollBy,
    setupMode,
    boardResource,
    boardPip,
    longestRoadPlayerId,
    largestArmyPlayerId,
    bank: {
      resources: { ...bankResources },
      developmentCards: { ...bankDevelopmentCards }
    },
    reset: false
  }
}

function broadcastState() {
  const payload = JSON.stringify(getState())
  for (const client of clients) {
    client.write(`event: state\ndata: ${payload}\n\n`)
  }
}

function pushHistory(actionDescription, actorName) {
  history.push({
    description: actionDescription,
    actorName,
    snapshot: captureSnapshot()
  })
}

function chooseDevelopmentCard() {
  const available = developmentCardTypes.filter((card) => bankDevelopmentCards[card.key] > 0)
  if (!available.length) {
    return null
  }

  const selected = available[Math.floor(Math.random() * available.length)]
  return selected.key
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

    const player = createPlayer(name, nextPlayerId++)
    pushHistory(`${player.name} joined the game.`, player.name)
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
    pushHistory(`${displayName} pressed Count.`, displayName)
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
    pushHistory(`${displayName} rolled a die.`, displayName)
    const roll = dicePool[Math.floor(Math.random() * dicePool.length)]
    player.rolls += 1
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

    pushHistory(`${displayName} placed a road.`, displayName)
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

    pushHistory(`${displayName} placed a settlement.`, displayName)
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

    pushHistory(`${displayName} placed a city.`, displayName)
    player.cities -= 1
    addEvent(`${displayName} placed a city.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/take-resource', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const resource = req.body?.resource

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (!resource || !bankResources[resource]) {
      return res.status(400).json({ error: 'That resource is not available.' })
    }

    const { player, displayName } = resolved
    if (bankResources[resource] <= 0) {
      return res.status(400).json({ error: 'The bank is out of that resource.' })
    }

    pushHistory(`${displayName} took 1 ${resource} from the bank.`, displayName)
    bankResources[resource] -= 1
    player.resources[resource] += 1
    addEvent(`${displayName} took 1 ${resource} from the bank.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/return-resource', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const resource = req.body?.resource

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (!resource || !bankResources[resource]) {
      return res.status(400).json({ error: 'That resource is not available.' })
    }

    const { player, displayName } = resolved
    if ((player.resources[resource] || 0) <= 0) {
      return res.status(400).json({ error: 'You do not have that resource to return.' })
    }

    if (bankResources[resource] >= 19) {
      return res.status(400).json({ error: 'The bank already has the maximum of that resource.' })
    }

    pushHistory(`${displayName} returned 1 ${resource} to the bank.`, displayName)
    player.resources[resource] -= 1
    bankResources[resource] += 1
    addEvent(`${displayName} returned 1 ${resource} to the bank.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/take-development-card', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (setupMode) {
      return res.status(400).json({ error: 'Development cards are only available when setup mode is off.' })
    }

    const { player, displayName } = resolved
    const cardKey = chooseDevelopmentCard()

    if (!cardKey) {
      return res.status(400).json({ error: 'The bank is out of development cards.' })
    }

    pushHistory(`${displayName} took a development card.`, displayName)
    bankDevelopmentCards[cardKey] -= 1
    player.developmentCards[cardKey] += 1
    addEvent(`${displayName} took a development card.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/take-longest-road', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved
    longestRoadPlayerId = player.id
    pushHistory(`${displayName} claimed longest road.`, displayName)
    addEvent(`${displayName} claimed longest road.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/take-largest-army', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved
    largestArmyPlayerId = player.id
    pushHistory(`${displayName} claimed largest army.`, displayName)
    addEvent(`${displayName} claimed largest army.`)
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
    pushHistory(`${displayName} randomized the tile.`, displayName)
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

    pushHistory(`${displayName} randomized the pip value.`, displayName)
    boardPip = dicePool[Math.floor(Math.random() * dicePool.length)]
    addEvent(`${displayName} randomized the pip value to ${boardPip}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/toggle-setup', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const actorName = resolved?.displayName || req.body?.playerName || 'A player'

    pushHistory(`${actorName} toggled setup mode.`, actorName)
    setupMode = Boolean(req.body?.enabled)
    addEvent(`${actorName} ${setupMode ? 'enabled' : 'disabled'} setup mode.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/undo', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const actorName = resolved?.displayName || req.body?.playerName || 'A player'

    if (!history.length) {
      return res.status(400).json({ error: 'There is nothing to undo.' })
    }

    const previous = history.pop()
    restoreSnapshot(previous.snapshot)
    addEvent(`${actorName} undid ${previous.description}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/reset-game', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const actorName = resolved?.displayName || req.body?.playerName || 'A player'

    pushHistory(`${actorName} flipped the board and reset the game.`, actorName)
    resetGameState()
    addEvent(`${actorName} flipped the board and reset the game.`)
    broadcastState()

    return res.json({ state: getState(), reset: true })
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
