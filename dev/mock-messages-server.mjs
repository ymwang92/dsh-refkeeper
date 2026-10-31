/**
 * Dev-only mock of the Anthropic Messages API (`POST /v1/messages`, SSE).
 *
 * Purpose: exercise the real DSH agent loop — system prompt, tool schemas,
 * tool execution, tool_result replay — without a provider credential, so M0
 * contract probes can run end to end on the actual harness build.
 *
 * Behaviour:
 *   request without tool_result  -> calls the requested tool (`MOCK_TOOL`, default ref_ping)
 *   request with tool_result     -> echoes the tool output back as final text
 *
 * Usage:
 *   node dev/mock-messages-server.mjs            # listens on 127.0.0.1:3999
 *   MOCK_PORT=4123 MOCK_TOOL=ref_ping node dev/mock-messages-server.mjs
 *
 * Then launch the harness against it:
 *   DEEPSEEK_API_KEY=mock DEEPSEEK_BASE_URL=http://127.0.0.1:3999 dsh ...
 *
 * Never ship this in the published package (see package.json `files`).
 */
import { createServer } from 'node:http'

const PORT = Number(process.env['MOCK_PORT'] ?? 3999)
const HOST = process.env['MOCK_HOST'] ?? '127.0.0.1'
const TOOL = process.env['MOCK_TOOL'] ?? 'ref_ping'
const MAX_TOOL_ROUNDS = Number(process.env['MOCK_MAX_ROUNDS'] ?? 4)
/** Arguments sent with the mock tool_use, as JSON (e.g. ref_capture needs fields). */
const TOOL_ARGS = process.env['MOCK_ARGS'] ?? '{}'

const log = (...parts) => console.error('[mock-messages]', ...parts)

/** Texts already produced by a tool_result round, keyed by tool_use id. */
let messageSeq = 0

const sse = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const blocks = (message) => (Array.isArray(message.content) ? message.content : [])

const toolResultText = (message) =>
  blocks(message)
    .filter((block) => block.type === 'tool_result')
    .map((block) => {
      const content = block.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .map((part) => (part.type === 'text' ? part.text : `[${String(part.type)}]`))
          .join('\n')
      }
      return JSON.stringify(content)
    })
    .join('\n')

const toolUseCount = (messages) =>
  messages.reduce(
    (total, message) =>
      total + blocks(message).filter((block) => block.type === 'tool_use').length,
    0,
  )

function respondToolUse(res, model, name) {
  const id = `toolu_mock_${(messageSeq += 1)}`
  const inputJson = TOOL_ARGS
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_mock_${messageSeq}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 42, output_tokens: 1 },
    },
  })
  // Two legal shapes, selectable because hosts differ on when they snapshot a
  // tool_use block: `delta` streams like the real API; `start` places the whole
  // input in content_block_start and sends no delta at all. Never both — that
  // makes the client assemble the JSON twice.
  const argsInStart = process.env['MOCK_ARGS_MODE'] === 'start'
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id, name, input: argsInStart ? JSON.parse(inputJson) : {} },
  })
  if (!argsInStart) {
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: inputJson },
    })
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 12 },
  })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

function respondText(res, model, text) {
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_mock_${(messageSeq += 1)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 5 },
    },
  })
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })
  sse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 40 },
  })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !(req.url ?? '').includes('/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"not found"}')
    return
  }
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => {
    raw += chunk
  })
  req.on('end', () => {
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {
      log('unparsable body')
    }
    const model = typeof body.model === 'string' ? body.model : 'mock'
    const messages = Array.isArray(body.messages) ? body.messages : []
    const tools = Array.isArray(body.tools) ? body.tools : []
    const toolNames = tools.map((tool) => tool?.name).filter((name) => typeof name === 'string')
    const results = messages.map(toolResultText).filter((text) => text !== '')
    const tainted = messages.some((message) => message.role === 'tool' || message.role === 'function')

    log(
      'request',
      JSON.stringify({
        model,
        messages: messages.length,
        tools: toolNames.length,
        hasTool: toolNames.includes(TOOL),
        toolResults: results.length,
        legacyToolRole: tainted,
        rounds: toolUseCount(messages),
      }),
    )

    if (results.length > 0) {
      const latest = results.at(-1) ?? ''
      log('--- tool_result payload ---')
      log(latest)
      log('--- end payload ---')
      respondText(res, model, `MOCK_FINAL\n${latest}`)
      return
    }

    if (toolUseCount(messages) >= MAX_TOOL_ROUNDS) {
      respondText(res, model, 'MOCK_FINAL: tool round limit reached')
      return
    }

    if (!toolNames.includes(TOOL)) {
      respondText(res, model, `MOCK_FINAL: tool ${TOOL} unavailable; tools=${toolNames.join(',')}`)
      return
    }

    respondToolUse(res, model, TOOL)
  })
})

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} (tool=${TOOL})`)
})
