// Open a fresh GUI page, navigate to the plugin page, and dump its content.
// usage: node dev/gui-fresh-plugins.mjs <debugPort> <guiUrl> <shot.png>
const [, , portArg, guiUrl, shot] = process.argv
const port = Number(portArg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const target = await (
  await fetch(`http://127.0.0.1:${String(port)}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
  })
).json()

const ws = new WebSocket(target.webSocketDebuggerUrl)
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
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.value

await send('Page.enable')
await send('Page.navigate', { url: guiUrl })
await sleep(6000)

await evaluate(`(() => {
  const click = (label) => {
    const el = [...document.querySelectorAll('button, a')].find((n) => (n.getAttribute('aria-label') ?? n.textContent.trim()) === label)
    el?.click()
    return Boolean(el)
  }
  return click('插件')
})()`)
await sleep(6000)

const state = await evaluate(`(() => ({
  text: (document.body.innerText || '').slice(0, 900),
  skeletons: document.querySelectorAll('[class*=skeleton]').length,
  cards: document.querySelectorAll('[class*=card]').length,
}))()`)
console.log(JSON.stringify(state, null, 2))

const img = await send('Page.captureScreenshot', { format: 'png' })
const { writeFile } = await import('node:fs/promises')
await writeFile(shot, Buffer.from(img.data, 'base64'))
console.log(`screenshot: ${shot}`)
ws.close()
process.exit(0)
