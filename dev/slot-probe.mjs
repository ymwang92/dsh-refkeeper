// Slot probe: attach to the already-open GUI target, click the refkeeper
// button with a real mouse event, then read the label back after React has
// committed. Node-side sleeps keep this free of awaitPromise (which hangs when
// the page swaps targets mid-evaluate).
//
// usage: node dev/slot-probe.mjs <debugPort> <shot.png>
const [, , portArg, shot] = process.argv
const port = Number(portArg)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const targets = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:3099'))
if (!page) throw new Error(`no GUI target; saw: ${targets.map((t) => t.url).join(', ')}`)

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
await new Promise((resolve, reject) => {
  ws.addEventListener('open', () => resolve(undefined), { once: true })
  ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const out = await send('Runtime.evaluate', { expression, returnByValue: true })
  return out.result?.value
}

const before = await evaluate(`(() => {
  const b = document.querySelector('[aria-label="dsh-refkeeper capture"]')
  if (!b) return { found: false }
  const r = b.getBoundingClientRect()
  const composer = b.closest('[data-slot="conversation.input.left"]') ?? b.parentElement
  return {
    found: true,
    label: b.textContent,
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    parentSlot: composer?.getAttribute?.('data-slot') ?? null,
    parentTag: composer?.tagName ?? null,
  }
})()`)
console.log('before:', JSON.stringify(before))

if (before?.found) {
  const cx = before.box.x + before.box.w / 2
  const cy = before.box.y + before.box.h / 2
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  }
  await sleep(600)
  const after = await evaluate(
    `document.querySelector('[aria-label="dsh-refkeeper capture"]')?.textContent ?? null`,
  )
  console.log('after one real click:', JSON.stringify(after))
}

const shotOut = await send('Page.captureScreenshot', { format: 'png' })
const { writeFile } = await import('node:fs/promises')
await writeFile(shot, Buffer.from(shotOut.data, 'base64'))
console.log(`screenshot: ${shot}`)
ws.close()
process.exit(0)
