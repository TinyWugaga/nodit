export function Frame({ className = '' }: { className?: string }) {
  return (
    <span className={`frame ${className}`} aria-hidden>
      <span className="frame__shape" />
    </span>
  )
}

export function StatusDots({ rank, total = 3 }: { rank: number; total?: number }) {
  return (
    <span className="dots" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < rank ? 'is-on' : undefined} />
      ))}
    </span>
  )
}

export function Rule() {
  return <span className="rule" aria-hidden />
}
