// Run one expression inside the already-open GUI page and optionally screenshot.
// Node-side timeouts keep a detached target from wedging the shell.
//
// usage: node dev/gui-eval.mjs <debugPort> <expression> [shot.png]
const [, , portArg, expression, shot] = process.argv
const port = Number(portArg)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const guard = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timeout: ${label}`)
    }),
  ])

const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
const pages = list.filter((t) => t.type === 'page' && t.url.includes('127.0.0.1:3099'))
if (pages.length === 0) throw new Error('no GUI page target')
const page = pages[pages.length - 1]

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === undefined) return
  const slot = pending.get(msg.id)
  pending.delete(msg.id)
  if (!slot) return
  msg.error ? slot.reject(new Error(JSON.stringify(msg.error))) : slot.resolve(msg.result)
})
await guard(
  new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(undefined), { once: true })
    ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
  }),
  5000,
  'ws open',
)

const send = async (method, params = {}) => {
  const id = nextId++
  const reply = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return guard(reply, 15000, method)
}

const awaitPromise = process.env.AWAIT === '1'
const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
if (out.exceptionDetails) {
  console.error('evaluate threw:', JSON.stringify(out.exceptionDetails).slice(0, 800))
} else {
  console.log(JSON.stringify(out.result?.value ?? null, null, 2))
}

if (shot) {
  const img = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(shot, Buffer.from(img.data, 'base64'))
  console.log(`screenshot: ${shot}`)
}

ws.close()
process.exit(0)
