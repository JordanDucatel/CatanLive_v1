const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5001

const app = express()
let clickCount = 0

app
  .use(express.json())
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.render('pages/index', {
    title: 'CatanLive_v1',
    message: 'Welcome to CatanLive',
    count: clickCount
  }))
  .post('/count', (req, res) => {
    clickCount += 1
    res.json({ count: clickCount })
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`))
