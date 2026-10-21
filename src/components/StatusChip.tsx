import { STATUS_LABEL } from '../presentation'
import type { CardKind } from '../types'

export function StatusChip({ kind, status, solid }: { kind: CardKind; status: string; solid?: boolean }) {
  const label = (STATUS_LABEL[kind] as Record<string, string>)[status] ?? status
  return (
    <span className={`chip mono${solid ? ' chip--solid' : ''}`} data-status={status}>
      {solid && <i />}
      {solid ? `Status: ${label}` : label}
    </span>
  )
}
