// Print the GUI session cookies so the host API can be exercised from the shell.
// usage: node dev/gui-cookies.mjs <debugPort>
const port = Number(process.argv[2])

const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
const page = list.filter((t) => t.type === 'page' && t.url.includes('127.0.0.1:3099')).at(-1)
if (!page) throw new Error('no GUI page target')

const ws = new WebSocket(page.webSocketDebuggerUrl)
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

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
const { cookies } = await send('Storage.getCookies')
const mine = cookies.filter((c) => c.domain.includes('127.0.0.1'))
console.log(mine.map((c) => `${c.name}=${c.value}`).join('; '))
ws.close()
process.exit(0)
