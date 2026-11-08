import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionLike, SessionQueryLike } from '../src/host/session-read.ts'

const mocks = vi.hoisted(() => ({
  saveCaptured: vi.fn(),
  annotateCaptured: vi.fn(),
  writeBatch: vi.fn(),
}))

vi.mock('../src/host/capture-save.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/capture-save.ts')>()
  return { ...actual, saveCaptured: mocks.saveCaptured }
})

vi.mock('../src/host/annotate.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/annotate.ts')>()
  return { ...actual, annotateCaptured: mocks.annotateCaptured }
})

vi.mock('../src/host/capture-batch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/capture-batch.ts')>()
  return { ...actual, writeBatch: mocks.writeBatch }
})

import plugin from '../src/index.ts'

const USER_TEXT =
  '见 Zhang, S. (2024). Attention and memory. Nature, 625(3), 45-67. doi:10.1038/s41586-024-00001-x'

const SESSION: SessionLike = {
  id: 'synthetic-session',
  seq: 9,
  surface: { nodes: [3, 4] },
  header: { cwd: '/synthetic-workspace' },
  eventAt: () => undefined,
}

const QUERY: SessionQueryLike = {
  async listEvents() {
    return [
      { seq: 2, type: 'turn/start' },
      { seq: 3, type: 'user/message' },
      { seq: 4, type: 'assistant/message' },
      { seq: 5, type: 'turn/start' },
      { seq: 9, type: 'user/message' },
    ]
  },
  async readEvent(request) {
    return {
      events: [
        {
          seq: 9,
          type: 'user/message',
          data: { content: [{ type: 'text', text: USER_TEXT }] },
        },
      ].filter((event) => event.seq <= request.seq),
    }
  },
}

type CommandResult = { readonly kind: string; readonly text: string }
type CommandHandler = (invocation: unknown) => Promise<CommandResult>

interface FakeContext {
  readonly tools: { register(tool: unknown): void }
  readonly commands: {
    register(definition: unknown): void
  }
  readonly sessionProjections: { stateOf(session: never, key: string): unknown }
  readonly sessionQuery: SessionQueryLike
  inject(dependencies: readonly string[], callback: (context: FakeContext) => unknown): void
  effect(callback: () => unknown): void
  get(name: string): unknown
}

function mountCommand(): CommandHandler {
  let handler: CommandHandler | undefined
  const context: FakeContext = {
    tools: { register: () => undefined },
    commands: {
      register(definition) {
        const command = definition as { readonly handler: CommandHandler }
        handler = command.handler
      },
    },
    sessionProjections: { stateOf: () => undefined },
    sessionQuery: QUERY,
    inject(_dependencies, callback) {
      callback(context)
    },
    effect(callback) {
      callback()
    },
    get: () => undefined,
  }

  plugin.apply(context as never)
  if (handler === undefined) throw new Error('/refs command was not registered')
  return handler
}

describe('index capture persistence failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveCaptured.mockResolvedValue({
      saved: 1,
      quarantined: 0,
      skipped: 0,
      failed: 0,
      entries: [
        {
          title: 'Attention and memory',
          status: 'saved',
          id: 'synthetic-ref-1',
          doi: '10.1038/s41586-024-00001-x',
        },
      ],
    })
    mocks.annotateCaptured.mockResolvedValue({
      entries: [
        {
          title: 'Attention and memory',
          status: 'saved',
          id: 'synthetic-ref-1',
          doi: '10.1038/s41586-024-00001-x',
          annotated: true,
        },
      ],
      outcome: { annotated: 1, considered: 1, model: 'synthetic/test', ids: ['synthetic-ref-1'] },
    })
    mocks.writeBatch.mockRejectedValue(new Error('snapshot write failed\nsecondary detail'))
  })

  it('keeps the save/annotation summary, sanitizes the failure and omits the success marker', async () => {
    const handler = mountCommand()
    const result = await handler({
      rawInput: 'capture --scope=all --save',
      agent: { session: SESSION },
    })

    expect(result.kind).toBe('success')
    expect(result.text).toContain('saved: 1 · quarantine: 0 · skipped (no title): 0 · failed: 0')
    expect(result.text).toContain('annotations: 1 of 1 annotated by synthetic/test')
    expect(result.text).toContain('Batch persistence failed: snapshot write failed secondary detail')
    expect(result.text).not.toContain('refkeeper-batch:')
    expect(mocks.writeBatch).toHaveBeenCalledOnce()
  })
})
