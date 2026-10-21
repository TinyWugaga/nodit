import { createInterface } from 'node:readline'
import { acquireOwner, LockBusyError } from '../../core/owner'

/** Handshake over stdin: report ready, acquire on "go", hold until "release" so overlaps are certain. */
const root = process.argv[2]
const rl = createInterface({ input: process.stdin })
const lines = rl[Symbol.asyncIterator]()
console.log('ready')
await lines.next()
try {
  const owner = await acquireOwner(root, 'cli')
  console.log('ok')
  await lines.next()
  await owner.release()
} catch (err) {
  console.log(err instanceof LockBusyError ? 'busy' : `error ${(err as Error).message}`)
}
rl.close()
