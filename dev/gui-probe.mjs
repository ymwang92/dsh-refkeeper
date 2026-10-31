// GUI slot probe with per-step timeouts. Attaches to an existing page target,
// clicks the refkeeper button, reads its label, and saves a screenshot.
//
// usage: node dev/gui-probe.mjs <debugPort> <shot.png>
const [, , portArg, shot] = process.argv
const port = Number(portArg)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const guard = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`timeout: ${label} (${String(ms)}ms)`)
    }),
  ])

const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
const pages = list.filter((t) => t.type === 'page' && t.url.includes('127.0.0.1:3099'))
if (pages.length === 0) throw new Error('no GUI page target')
const page = pages[pages.length - 1]
console.log(`target: ${page.id.slice(0, 8)} ${page.url}`)

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
  return guard(reply, 10000, method)
}

const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value

const before = await evaluate(`(() => {
  const b = document.querySelector('[aria-label="dsh-refkeeper capture"]')
  if (!b) return { found: false, body: (document.body.innerText || '').slice(0, 120) }
  const r = b.getBoundingClientRect()
  return { found: true, label: b.textContent, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
})()`)
console.log('before:', JSON.stringify(before))

if (before?.found) {
  const cx = before.box.x + before.box.w / 2
  const cy = before.box.y + before.box.h / 2
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  }
  await sleep(500)
  const after = await evaluate(
    `document.querySelector('[aria-label="dsh-refkeeper capture"]')?.textContent ?? null`,
  )
  console.log('after one real click:', JSON.stringify(after))
}

try {
  const img = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(shot, Buffer.from(img.data, 'base64'))
  console.log(`screenshot: ${shot}`)
} catch (error) {
  console.error(`screenshot failed: ${error.message}`)
}

ws.close()
process.exit(0)
