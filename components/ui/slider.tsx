"use client"

// Простой слайдер через <input type="range">.
// API совместим с shadcn/ui Slider: value=number[], onValueChange=(v: number[]) => void.

import * as React from "react"
import { cn } from "@/lib/utils"

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value?: number[]
  onValueChange?: (value: number[]) => void
  min?: number
  max?: number
  step?: number
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    const current = value?.[0] ?? min

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange?.([parseFloat(e.target.value)])
    }

    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={handleChange}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary",
          className,
        )}
        {...props}
      />
    )
  },
)
Slider.displayName = "Slider"

export { Slider }
