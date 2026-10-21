import type { ServerResponse } from 'node:http'
import type { ChangeEvent, ProjectService } from './project'

/** SSE fan-out. Each new connection first receives `hello` with the current session and rev. */
export class EventHub {
  private clients = new Set<ServerResponse>()
  private keepAlive: NodeJS.Timeout

  constructor(private project: ProjectService) {
    project.on('change', (e: ChangeEvent) => this.broadcast('snapshot-changed', e))
    this.keepAlive = setInterval(() => {
      for (const c of this.clients) c.write(': ping\n\n')
    }, 25_000)
  }

  attach(res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    this.clients.add(res)
    res.on('close', () => this.clients.delete(res))
    this.send(res, 'hello', this.project.envelope({}))
  }

  broadcast(event: string, data: unknown) {
    for (const c of this.clients) this.send(c, event, data)
  }

  close() {
    clearInterval(this.keepAlive)
    for (const c of this.clients) c.end()
    this.clients.clear()
  }

  private send(res: ServerResponse, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}
