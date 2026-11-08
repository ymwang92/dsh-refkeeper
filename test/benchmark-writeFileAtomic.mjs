import { open, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { writeFileAtomic } from '../src/store/atomic.ts'

const payload = 'x'.repeat(986)
const warmups = 2
const samples = 10
const tempRoot = resolve(await realpath(tmpdir()))
const tempPrefix = 'dsh-refkeeper-write-bench-'
const directory = await mkdtemp(join(tempRoot, tempPrefix))
const benchmarkDirectory = resolve(await realpath(directory))

function assertBenchmarkDirectory() {
  if (
    dirname(benchmarkDirectory) !== tempRoot ||
    !basename(benchmarkDirectory).startsWith(tempPrefix)
  ) {
    throw new Error(`refusing to use unexpected benchmark directory: ${benchmarkDirectory}`)
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

async function measure(write) {
  const timings = []
  for (let index = 0; index < warmups + samples; index += 1) {
    const start = performance.now()
    await write()
    const elapsed = performance.now() - start
    if (index >= warmups) timings.push(Number(elapsed.toFixed(3)))
  }
  return { samplesMs: timings, medianMs: Number(median(timings).toFixed(3)) }
}

try {
  const atomicFile = join(benchmarkDirectory, 'refs.json')
  const plainFile = join(benchmarkDirectory, 'plain.json')
  const atomic = await measure(() => writeFileAtomic(atomicFile, payload))
  const plain = await measure(async () => {
    const handle = await open(plainFile, 'w')
    try {
      await handle.writeFile(payload, 'utf8')
    } finally {
      await handle.close()
    }
  })

  console.log(JSON.stringify({
    runtime: process.version,
    payloadBytes: Buffer.byteLength(payload, 'utf8'),
    warmups,
    measuredSamples: samples,
    benchmark: 'same journaled refs.json for each write; plain control uses open(w)+writeFile+close',
    atomic,
    plain,
  }, null, 2))
} finally {
  assertBenchmarkDirectory()
  await rm(benchmarkDirectory, { recursive: true, force: true })
}
