import { WebSocketServer } from 'ws'
import { createRoom } from './room'

const port = Number(process.env.WS_PORT ?? 8787)
const room = createRoom()
const server = new WebSocketServer({ port, host: '127.0.0.1' })

server.on('connection', (socket) => {
  room.connect(socket)
})

server.on('listening', () => {
  console.log(`websocket listening on ws://127.0.0.1:${port}`)
})
