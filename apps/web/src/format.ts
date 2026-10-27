export function formatRubles(amount: number): string {
  const body = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${body} ₽`
}

export function formatClock(at: number): string {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function formatRemaining(remainingMs: number): string {
  const safe = Math.max(0, remainingMs)
  const totalSeconds = Math.ceil(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
