import { CircleCheck, Flag, Signpost } from 'lucide-react'
import type { CardKind } from '../types'

const ICONS = { adr: Signpost, milestone: Flag, task: CircleCheck }

export function KindIcon({ kind, size = 14 }: { kind: CardKind; size?: number }) {
  const Icon = ICONS[kind]
  return <Icon size={size} strokeWidth={2} aria-hidden />
}
