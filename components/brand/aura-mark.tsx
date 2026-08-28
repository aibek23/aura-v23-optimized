export function AuraMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="Aura"
    >
      <defs>
        <linearGradient id="aura-g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.85 0.13 85)" />
          <stop offset="1" stopColor="oklch(0.68 0.13 68)" />
        </linearGradient>
      </defs>
      <path
        d="M24 4 L40 40 L31 40 L24 21 L17 40 L8 40 Z"
        fill="url(#aura-g)"
      />
      <circle cx="24" cy="12" r="3.2" fill="url(#aura-g)" />
    </svg>
  )
}
