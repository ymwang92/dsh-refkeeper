import { verifyCandidate } from '../src/verify/lookup.ts'
import { renderVerify } from '../src/host/verify-command.ts'

const claim = {
  title: 'Nanometre-scale thermometry in a living cell',
  authors: ['Kucsko, G.'],
  year: 2013,
  doi: '10.1038/nature12373',
}
const outcome = await verifyCandidate(claim)
console.log(renderVerify(outcome))
console.log('---')
const fake = await verifyCandidate({ doi: '10.1000/refkeeper-does-not-exist' })
console.log(renderVerify(fake))
