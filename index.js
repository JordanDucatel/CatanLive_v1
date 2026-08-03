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
const boardTileDistribution = [
  'Ore', 'Ore', 'Ore',
  'Wheat', 'Wheat', 'Wheat', 'Wheat',
  'Wood', 'Wood', 'Wood', 'Wood',
  'Sheep', 'Sheep', 'Sheep', 'Sheep',
  'Brick', 'Brick', 'Brick',
  'Desert'
]
const boardPipDistribution = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
const boardCornerOffsets = [
  { x: 1, y: 1, z: -2 },
  { x: 2, y: -1, z: -1 },
  { x: 1, y: -2, z: 1 },
  { x: -1, y: -1, z: 2 },
  { x: -2, y: 1, z: 1 },
  { x: -1, y: 2, z: -1 }
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
const gamePhases = ['boardSetup', 'initialPlacement', 'play', 'endGame']

let nextPlayerId = 1
let lastRoll = null
let lastRollBy = null
let setupMode = true
let gamePhase = 'boardSetup'
let boardResource = null
let boardPip = null
let longestRoadPlayerId = null
let largestArmyPlayerId = null
let winnerPlayerId = null
let winnerName = null
let boardRoads = []
let boardPoints = []
let boardHexes = []

function createBoardLayoutHexes() {
  const layout = []
  let id = 0

  for (let r = -2; r <= 2; r += 1) {
    const qMin = Math.max(-2, -r - 2)
    const qMax = Math.min(2, -r + 2)

    for (let q = qMin; q <= qMax; q += 1) {
      layout.push({ id: id++, q, r })
    }
  }

  return layout
}

function getCornerKey(x2, y2, z2) {
  return `${x2}:${y2}:${z2}`
}

function createBoardNetwork() {
  const layoutHexes = createBoardLayoutHexes()
  const pointsByKey = new Map()
  const roadsByKey = new Map()
  const points = []
  const roads = []

  const hexes = layoutHexes.map((hex) => {
    const x = hex.q
    const z = hex.r
    const y = -x - z

    const pointIds = boardCornerOffsets.map((offset) => {
      const x2 = (x * 2) + offset.x
      const y2 = (y * 2) + offset.y
      const z2 = (z * 2) + offset.z
      const key = getCornerKey(x2, y2, z2)

      if (!pointsByKey.has(key)) {
        const id = points.length
        pointsByKey.set(key, id)
        points.push({
          id,
          x2,
          y2,
          z2,
          ownerId: null,
          ownerColor: null,
          pieceType: null
        })
      }

      return pointsByKey.get(key)
    })

    const roadIds = []
    for (let index = 0; index < pointIds.length; index += 1) {
      const first = pointIds[index]
      const second = pointIds[(index + 1) % pointIds.length]
      const pointA = Math.min(first, second)
      const pointB = Math.max(first, second)
      const edgeKey = `${pointA}:${pointB}`

      if (!roadsByKey.has(edgeKey)) {
        const id = roads.length
        roadsByKey.set(edgeKey, id)
        roads.push({
          id,
          pointA,
          pointB,
          ownerId: null,
          ownerColor: null
        })
      }

      roadIds.push(roadsByKey.get(edgeKey))
    }

    return {
      id: hex.id,
      q: hex.q,
      r: hex.r,
      resource: null,
      pip: null,
      pointIds,
      roadIds
    }
  })

  return {
    points,
    roads,
    hexes
  }
}

function shuffle(list) {
  const next = list.slice()
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const temp = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = temp
  }
  return next
}

function buildBoardHexes(tiles, pips) {
  const next = []
  let pipIndex = 0

  for (let id = 0; id < 19; id += 1) {
    const resource = tiles[id]
    const pip = resource === 'Desert' ? null : pips[pipIndex++]
    next.push({ id, resource, pip })
  }

  return next
}

function randomizeBoardResources() {
  const shuffledTiles = shuffle(boardTileDistribution)
  const pipsByHexId = Array.from({ length: 19 }, (_, id) => boardHexes[id]?.pip ?? null)

  boardHexes = shuffledTiles.map((resource, id) => ({
    ...boardHexes[id],
    resource,
    pip: resource === 'Desert' ? null : pipsByHexId[id]
  }))
}

function randomizeBoardPips() {
  const shuffledPips = shuffle(boardPipDistribution)
  let pipIndex = 0
  boardHexes = boardHexes.map((hex) => {
    if (hex.resource === 'Desert') {
      return { ...hex, pip: null }
    }

    const pip = shuffledPips[pipIndex++]
    return { ...hex, pip }
  })
}

function initializeBoardHexes() {
  const base = createBoardNetwork()
  boardPoints = base.points
  boardRoads = base.roads

  const shuffledTiles = shuffle(boardTileDistribution)
  const shuffledPips = shuffle(boardPipDistribution)
  boardHexes = buildBoardHexes(shuffledTiles, shuffledPips).map((hex, id) => ({
    ...base.hexes[id],
    resource: hex.resource,
    pip: hex.pip
  }))
}

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
    gamePhase,
    winnerPlayerId,
    winnerName,
    setupMode,
    boardResource,
    boardPip,
    longestRoadPlayerId,
    largestArmyPlayerId,
    boardRoads: boardRoads.map((slot) => ({ ...slot })),
    boardPoints: boardPoints.map((slot) => ({ ...slot })),
    boardHexes: boardHexes.map((hex) => ({ ...hex })),
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
  gamePhase = snapshot.gamePhase || 'boardSetup'
  winnerPlayerId = snapshot.winnerPlayerId || null
  winnerName = snapshot.winnerName || null
  setupMode = snapshot.setupMode !== undefined ? snapshot.setupMode : gamePhase === 'boardSetup'
  boardResource = snapshot.boardResource
  boardPip = snapshot.boardPip
  longestRoadPlayerId = snapshot.longestRoadPlayerId
  largestArmyPlayerId = snapshot.largestArmyPlayerId
  if (snapshot.boardRoads && snapshot.boardPoints && snapshot.boardHexes) {
    boardRoads = snapshot.boardRoads.map((slot) => ({ ...slot }))
    boardPoints = snapshot.boardPoints.map((slot) => ({ ...slot }))
    boardHexes = snapshot.boardHexes.map((hex) => ({ ...hex }))
  } else {
    initializeBoardHexes()
  }
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
  gamePhase = 'boardSetup'
  winnerPlayerId = null
  winnerName = null
  setupMode = true
  boardResource = null
  boardPip = null
  longestRoadPlayerId = null
  largestArmyPlayerId = null
  initializeBoardHexes()
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
    gamePhase,
    winner: winnerPlayerId ? {
      playerId: winnerPlayerId,
      name: winnerName
    } : null,
    setupMode,
    boardResource,
    boardPip,
    board: {
      hexes: boardHexes.map((hex) => ({ ...hex })),
      roads: boardRoads.map((slot) => ({ ...slot })),
      points: boardPoints.map((slot) => ({ ...slot }))
    },
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

function initializeBoardState() {
  const base = createBoardNetwork()
  boardRoads = base.roads
  boardPoints = base.points
}

function syncSetupModeWithPhase() {
  setupMode = gamePhase === 'boardSetup'
}

function getPhaseLabel(phase) {
  if (phase === 'boardSetup') {
    return 'Board Setup'
  }
  if (phase === 'initialPlacement') {
    return 'Initial Placement'
  }
  if (phase === 'play') {
    return 'Play'
  }
  if (phase === 'endGame') {
    return 'End Of Game'
  }
  return phase
}

initializeBoardState()
initializeBoardHexes()
syncSetupModeWithPhase()

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

    if (gamePhase !== 'play') {
      return res.status(400).json({ error: 'Development cards are only available during the play phase.' })
    }

    if (winnerPlayerId) {
      return res.status(400).json({ error: 'The game is over.' })
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
  .post('/play-development-card', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const cardKey = req.body?.cardKey

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (gamePhase !== 'play') {
      return res.status(400).json({ error: 'Development cards can only be played during the play phase.' })
    }

    if (winnerPlayerId) {
      return res.status(400).json({ error: 'The game is over.' })
    }

    if (!cardKey || !['knights', 'monopoly', 'roadBuilding', 'yearOfPlenty'].includes(cardKey)) {
      return res.status(400).json({ error: 'That development card cannot be played.' })
    }

    const { player, displayName } = resolved
    if ((player.developmentCards[cardKey] || 0) <= 0) {
      return res.status(400).json({ error: 'You do not have that development card to play.' })
    }

    const cardName = developmentCardTypes.find((entry) => entry.key === cardKey)?.name || cardKey
    pushHistory(`${displayName} played a ${cardName.toLowerCase()} development card.`, displayName)
    player.developmentCards[cardKey] -= 1
    player.playedDevelopmentCards[cardKey] += 1
    addEvent(`${displayName} played a ${cardName.toLowerCase()} development card.`)
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
  .post('/place-piece', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const pieceType = req.body?.pieceType
    const targetType = req.body?.targetType
    const targetId = Number(req.body?.targetId)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    if (!Number.isInteger(targetId) || targetId < 0) {
      return res.status(400).json({ error: 'That board location is invalid.' })
    }

    const { player, displayName } = resolved

    if (winnerPlayerId) {
      return res.status(400).json({ error: 'The game is over.' })
    }

    if (pieceType === 'road') {
      if (targetType !== 'road') {
        return res.status(400).json({ error: 'Roads can only be placed on edge slots.' })
      }

      if (player.roads <= 0) {
        return res.status(400).json({ error: 'You do not have any roads left.' })
      }

      const slot = boardRoads.find((entry) => entry.id === targetId)
      if (!slot) {
        return res.status(400).json({ error: 'That road slot does not exist.' })
      }

      if (slot.ownerId) {
        return res.status(400).json({ error: 'That road slot is already occupied.' })
      }

      pushHistory(`${displayName} placed a road on edge ${targetId + 1}.`, displayName)
      slot.ownerId = player.id
      slot.ownerColor = player.color
      player.roads -= 1
      addEvent(`${displayName} placed a road.`)
      broadcastState()

      return res.json({ state: getState() })
    }

    if (pieceType === 'settlement') {
      if (targetType !== 'point') {
        return res.status(400).json({ error: 'Settlements can only be placed on point slots.' })
      }

      if (player.settlements <= 0) {
        return res.status(400).json({ error: 'You do not have any settlements left.' })
      }

      const slot = boardPoints.find((entry) => entry.id === targetId)
      if (!slot) {
        return res.status(400).json({ error: 'That point slot does not exist.' })
      }

      if (slot.ownerId) {
        return res.status(400).json({ error: 'That point slot is already occupied.' })
      }

      pushHistory(`${displayName} placed a settlement on point ${targetId + 1}.`, displayName)
      slot.ownerId = player.id
      slot.ownerColor = player.color
      slot.pieceType = 'settlement'
      player.settlements -= 1
      addEvent(`${displayName} placed a settlement.`)
      broadcastState()

      return res.json({ state: getState() })
    }

    if (pieceType === 'city') {
      if (targetType !== 'point') {
        return res.status(400).json({ error: 'Cities can only be placed on point slots.' })
      }

      if (player.cities <= 0) {
        return res.status(400).json({ error: 'You do not have any cities left.' })
      }

      const slot = boardPoints.find((entry) => entry.id === targetId)
      if (!slot || slot.ownerId !== player.id || slot.pieceType !== 'settlement') {
        return res.status(400).json({ error: 'Cities can only upgrade your own settlement.' })
      }

      pushHistory(`${displayName} upgraded a settlement to a city on point ${targetId + 1}.`, displayName)
      slot.pieceType = 'city'
      player.cities -= 1
      player.settlements += 1
      addEvent(`${displayName} upgraded a settlement to a city.`)
      broadcastState()

      return res.json({ state: getState() })
    }

    return res.status(400).json({ error: 'That piece type is not supported.' })
  })
  .post('/random-tile', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { displayName } = resolved

    if (gamePhase !== 'boardSetup') {
      return res.status(400).json({ error: 'Tiles can only be randomized during board setup.' })
    }

    pushHistory(`${displayName} randomized the board tiles.`, displayName)
    randomizeBoardResources()
    addEvent(`${displayName} randomized the board tiles.`)
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

    if (gamePhase !== 'boardSetup') {
      return res.status(400).json({ error: 'Pips can only be randomized during board setup.' })
    }

    pushHistory(`${displayName} randomized the board pips.`, displayName)
    randomizeBoardPips()
    addEvent(`${displayName} randomized the board pips.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/toggle-setup', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const actorName = resolved?.displayName || req.body?.playerName || 'A player'

    pushHistory(`${actorName} toggled setup mode.`, actorName)
    gamePhase = Boolean(req.body?.enabled) ? 'boardSetup' : 'play'
    syncSetupModeWithPhase()
    addEvent(`${actorName} switched the game phase to ${gamePhase === 'boardSetup' ? 'Board Setup' : 'Play'}.`)
    winnerPlayerId = null
    winnerName = null
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/set-game-phase', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)
    const actorName = resolved?.displayName || req.body?.playerName || 'A player'
    const phase = req.body?.phase

    if (!gamePhases.includes(phase)) {
      return res.status(400).json({ error: 'That game phase is invalid.' })
    }

    pushHistory(`${actorName} changed the game phase.`, actorName)
    gamePhase = phase
    syncSetupModeWithPhase()
    if (gamePhase !== 'endGame') {
      winnerPlayerId = null
      winnerName = null
    }
    addEvent(`${actorName} changed the game phase to ${getPhaseLabel(phase)}.`)
    broadcastState()

    return res.json({ state: getState() })
  })
  .post('/declare-winner', (req, res) => {
    const playerId = Number(req.body?.playerId)
    const resolved = resolvePlayer(playerId, req.body?.playerName)

    if (!resolved) {
      return res.status(404).json({ error: 'Player not found.' })
    }

    const { player, displayName } = resolved
    pushHistory(`${displayName} declared victory.`, displayName)
    winnerPlayerId = player.id
    winnerName = displayName
    gamePhase = 'endGame'
    syncSetupModeWithPhase()
    addEvent(`${displayName} won the game!`)
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
