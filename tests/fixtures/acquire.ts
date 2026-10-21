import { acquireOwner, LockBusyError } from '../../core/owner'

const [root, startAt] = process.argv.slice(2)
const wait = Number(startAt) - Date.now()
if (wait > 0) await new Promise((r) => setTimeout(r, wait))
try {
  const owner = await acquireOwner(root, 'cli')
  console.log('ok')
  await new Promise((r) => setTimeout(r, 4000))
  await owner.release()
} catch (err) {
  console.log(err instanceof LockBusyError ? 'busy' : `error ${(err as Error).message}`)
}
