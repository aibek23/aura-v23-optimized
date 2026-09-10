"use client"
import React, { memo } from "react"
import type { LabelSizeDef } from "@/lib/niimbot"

interface ShapeMeta {
  vbW: number
  vbH: number
  bodyW: number
  bodyH: number
}

const META: Record<string, ShapeMeta> = {
  T25x30_45:   { vbW: 25.12487, vbH: 74.945435, bodyW: 25.12487, bodyH: 30.02 },
  T30x25_45:   { vbW: 30,       vbH: 70,         bodyW: 30,       bodyH: 25   },
  T30x25_50:   { vbW: 30,       vbH: 75,         bodyW: 30,       bodyH: 25   },
  T50x30_rect: { vbW: 50,       vbH: 30,         bodyW: 50,       bodyH: 30   },
}

function getMeta(key: string): ShapeMeta {
  return META[key] ?? META["T25x30_45"]
}

export const SVG_PAD = 24
const TAIL_W_MM = 3

export function getBodyPx(sizeDef: LabelSizeDef): { w: number; h: number } {
  const m = getMeta(sizeDef.key)
  const pxPerMm = Math.min(sizeDef.w_px / m.bodyW, sizeDef.h_px / m.bodyH)
  return {
    w: Math.round(m.bodyW * pxPerMm),
    h: Math.round(m.bodyH * pxPerMm),
  }
}

export function getSvgLayout(
  key: string,
  sizeDef: LabelSizeDef,
): { svgW: number; svgH: number; canvasX: number; canvasY: number; pxPerMm: number } {
  const m = getMeta(key)
  const pxPerMm = Math.min(sizeDef.w_px / m.bodyW, sizeDef.h_px / m.bodyH)
  const svgW = Math.round(m.vbW * pxPerMm + SVG_PAD * 2)
  const svgH = Math.round(m.vbH * pxPerMm + SVG_PAD * 2)

  return {
    svgW,
    svgH,
    canvasX: SVG_PAD,
    canvasY: SVG_PAD,
    pxPerMm,
  }
}

function TagBody() {
  return (
    <>
      <path d="M 52.9134,0 H 3.77953 C 1.69215,0 0,1.69215 0,3.77953 V 90.7087 c 0,2.0873 1.69215,3.7795 3.77953,3.7795 H 52.9134 c 2.0874,0 3.7795,-1.6922 3.7795,-3.7795 V 3.77953 C 56.6929,1.69215 55.0008,0 52.9134,0 Z" fill="#d9d9d9" />
      <path d="M 109.606,0 H 60.4724 C 58.3851,0 56.6929,1.69215 56.6929,3.77953 V 90.7087 c 0,2.0873 1.6922,3.7795 3.7795,3.7795 h 49.1336 c 2.088,0 3.78,-1.6922 3.78,-3.7795 V 3.77953 C 113.386,1.69215 111.694,0 109.606,0 Z" fill="#d9d9d9" />
      <path d="M 108.4,2 H 61.6 C 59.6118,2 58,3.62968 58,5.64 v 83.72 c 0,2.0103 1.6118,3.64 3.6,3.64 h 46.8 c 1.988,0 3.6,-1.6297 3.6,-3.64 V 5.64 C 112,3.62968 110.388,2 110.4,2 Z" fill="#030303" fillOpacity={0.21} />
      <path d="M 51.4,2 H 4.6 C 2.61177,2 1,3.62968 1,5.64 V 89.36 C 1,91.3703 2.61177,93 4.6,93 H 51.4 C 53.3882,93 55,91.3703 55,89.36 V 5.64 C 55,3.62968 53.3882,2 51.4,2 Z" fill="#030303" fillOpacity={0.21} />
      <path d="M 56.6929,3.77954 V 90.7087" stroke="#acacac" strokeWidth={0.5} strokeDasharray="1, 1" />
    </>
  )
}

function ShapeT25x30_45() {
  return (
    <g transform="translate(-0.05418377,-0.05661559)">
      <g style={{ fill: "none" }} transform="matrix(0,0.26475095,-0.26564233,0,25.179054,0.05661559)">
        <g clipPath="url(#clip-t25)"><TagBody /></g>
      </g>
    </g>
  )
}

function ShapeT30x25() {
  return (
    <g style={{ fill: "none" }} transform="matrix(0.26440201,8.1001016e-4,0,0.26458333,0.00417149,-0.06087156)">
      <g clipPath="url(#clip-t30)"><TagBody /></g>
    </g>
  )
}

interface LabelBackgroundProps {
  sizeDef: LabelSizeDef
  rotation?: number
  className?: string
  style?: React.CSSProperties
}

export const LabelBackground = memo(function LabelBackground({
  sizeDef, rotation = 0, className, style,
}: LabelBackgroundProps) {
  const key = sizeDef.key
  const m = getMeta(key)
  const pxPerMm = Math.min(sizeDef.w_px / m.bodyW, sizeDef.h_px / m.bodyH)
  
  const baseSvgW = Math.round(m.vbW * pxPerMm + SVG_PAD * 2)
  const baseSvgH = Math.round(m.vbH * pxPerMm + SVG_PAD * 2)
  const padMm = SVG_PAD / pxPerMm
  const hasShape = key in META

  return (
    <div
      className={className}
      style={{
        pointerEvents: "none",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center center",
        willChange: "transform",
        ...style,
      }}
    >
      {hasShape ? (
        <svg
          width={baseSvgW}
          height={baseSvgH}
          viewBox={`${-padMm} ${-padMm} ${m.vbW + padMm * 2} ${m.vbH + padMm * 2}`}
          style={{ display: "block" }}
        >
          <defs>
            <clipPath id="clip-t25">
              <rect width="113.386" height="264.56699" x="0" y="0" fill="#ffffff" />
            </clipPath>
            <clipPath id="clip-t30">
              <rect width="113.386" height="264.56699" x="0" y="0" fill="#ffffff" />
            </clipPath>
            <filter id="paper-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0.6" stdDeviation="0.8" floodColor="rgba(0,0,0,0.45)" />
            </filter>
          </defs>

          <g filter="url(#paper-shadow)">
            {key === "T30x25_50" || key === "T30x25_45"
              ? <ShapeT30x25 />
              : <ShapeT25x30_45 />}

            {m.vbH > m.bodyH && (
              <rect
                x={(m.vbW - TAIL_W_MM) / 2} y={m.bodyH}
                width={TAIL_W_MM} height={m.vbH - m.bodyH}
                fill="#d9d9d9"
              />
            )}
          </g>

          <rect x={0} y={0} width={m.bodyW} height={m.bodyH}
            fill="none" stroke="rgba(59,130,246,0.7)"
            strokeWidth={0.18} strokeDasharray="1.5 1.2" />

          <rect x={1} y={1} width={m.bodyW - 2} height={m.bodyH - 2}
            fill="none" stroke="rgba(239,68,68,0.65)"
            strokeWidth={0.16} strokeDasharray="2 1.5" />

          {m.vbH > m.bodyH && (
            <line x1={0} y1={m.bodyH} x2={m.bodyW} y2={m.bodyH}
              stroke="rgba(156,163,175,0.8)"
              strokeWidth={0.3} strokeDasharray="1 1.5" />
          )}
        </svg>
      ) : (
        <div style={{
          width: sizeDef.w_px,
          height: sizeDef.h_px,
          background: "#ffffff",
          boxShadow: "0 2px 16px 0 rgba(0,0,0,0.18)",
        }} />
      )}
    </div>
  )
})