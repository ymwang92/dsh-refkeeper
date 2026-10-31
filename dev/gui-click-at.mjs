// Dispatch a real mouse click at viewport coordinates.
// usage: node dev/gui-click-at.mjs <debugPort> <x> <y>
const [, , portArg, xArg, yArg] = process.argv
const port = Number(portArg)
const x = Number(xArg)
const y = Number(yArg)

const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
const page = list.filter((t) => t.type === 'page' && t.url.includes('127.0.0.1:3099')).at(-1)
if (!page) throw new Error('no GUI page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let nextId = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    const handler = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', handler)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })

for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 40))
}
console.log(`clicked ${x},${y}`)
ws.close()
process.exit(0)
