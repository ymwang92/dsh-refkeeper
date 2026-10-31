// Minimal CDP driver: opens a page, waits for the app to settle, then runs
// one expression and optionally saves a screenshot. Uses Node's global
// WebSocket (Node >= 22), so it needs no dependencies.
//
// usage: node dev/cdp-probe.mjs <debugPort> <url> <expression> [screenshot.png]
const [, , portArg, url, expression, shot] = process.argv
const port = Number(portArg)

async function newTarget() {
  const res = await fetch(`http://127.0.0.1:${String(port)}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(`json/new failed: ${String(res.status)} ${await res.text()}`)
  return res.json()
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id)
      pending.delete(msg.id)
      if (slot) msg.error ? slot.reject(new Error(JSON.stringify(msg.error))) : slot.resolve(msg.result)
    } else {
      events.push(msg)
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(undefined), { once: true })
    ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true })
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { ready, send, events, close: () => ws.close() }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const target = await newTarget()
const cdp = connect(target.webSocketDebuggerUrl)
await cdp.ready
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.navigate', { url })
// The shell boots, then the client plugins load and mount React subtrees.
await sleep(6000)

const result = await cdp.send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
})
console.log(JSON.stringify(result.result?.value ?? result, null, 2))

const interesting = cdp.events.filter(
  (e) =>
    e.method === 'Runtime.exceptionThrown' ||
    e.method === 'Log.entryAdded' ||
    (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(e.params?.type)),
)
if (interesting.length > 0) {
  console.error(`--- console/exception (${String(interesting.length)}) ---`)
  for (const event of interesting.slice(0, 25)) {
    const p = event.params ?? {}
    const text =
      p.entry?.text ??
      p.exceptionDetails?.exception?.description ??
      p.exceptionDetails?.text ??
      (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    console.error(`[${event.method}] ${String(text).slice(0, 500)}`)
  }
}

if (shot) {
  const metrics = await cdp.send('Page.getLayoutMetrics')
  const clip = {
    x: 0,
    y: 0,
    width: Math.min(1200, Math.ceil(metrics.cssContentSize?.width ?? 1200)),
    height: Math.min(900, Math.ceil(metrics.cssContentSize?.height ?? 900)),
    scale: 1,
  }
  const img = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(shot, Buffer.from(img.data, 'base64'))
  console.log(`screenshot: ${shot}`)
}

cdp.close()
process.exit(0)
