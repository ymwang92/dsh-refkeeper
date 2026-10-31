// Capture console output and exceptions from the GUI page across one reload.
// usage: node dev/gui-console.mjs <debugPort> [waitMs]
const [, , portArg, waitArg] = process.argv
const port = Number(portArg)
const waitMs = Number(waitArg ?? 8000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')

const lines = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
    lines.push(`[console.${msg.params.type}] ${text}`.slice(0, 400))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    lines.push(`[exception] ${d.text} ${d.exception?.description ?? ''}`.slice(0, 400))
  }
  if (msg.method === 'Log.entryAdded') {
    lines.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`.slice(0, 400))
  }
  if (msg.method === 'Network.loadingFailed') {
    lines.push(`[net.failed] ${msg.params.errorText} ${msg.params.requestId}`)
  }
})

await send('Page.reload', { ignoreCache: false })
await sleep(waitMs)
const text = await send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0, 300)', returnByValue: true })

console.log(lines.slice(-25).join('\n') || '(no console output)')
console.log('--- body ---')
console.log(JSON.stringify(text.result?.value ?? null))
ws.close()
process.exit(0)
