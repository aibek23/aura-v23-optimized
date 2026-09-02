/**
 * LabelBackground — SVG-подложка ювелирной бирки (оригинальные эскизы Inkscape).
 *
 * Векторы взяты 1:1 из файлов T25_30+45.svg и T30_25+50.svg — ориентация
 * не меняется, хвостик смотрит вниз. Масштабирование пропорциональное:
 * один коэффициент pxPerMm, так что печатная область (тело бирки) точно
 * совпадает по размеру с Fabric-холстом (sizeDef.w_px × sizeDef.h_px).
 */

import type { LabelSizeDef, JewelryLabelSizeKey } from "@/lib/niimbot"

// ---------------------------------------------------------------------------
// Метрики форматов (в миллиметрах — координаты viewBox исходных SVG)
// ---------------------------------------------------------------------------
interface ShapeMeta {
  /** Полная ширина бумаги (мм) */
  vbW: number
  /** Полная высота бумаги вместе с хвостиком (мм) */
  vbH: number
  /** Ширина печатной области = ширина тела бирки (мм) */
  bodyW: number
  /** Высота печатной области = высота тела бирки без хвостика (мм) */
  bodyH: number
}

const META: Record<JewelryLabelSizeKey | "T50x30_rect", ShapeMeta> = {
  T25x30_45: { vbW: 25.12487, vbH: 74.945435, bodyW: 25.12487, bodyH: 30.02 },
  T30x25_45: { vbW: 30, vbH: 70, bodyW: 30, bodyH: 25 },
  T30x25_50: { vbW: 30, vbH: 75, bodyW: 30, bodyH: 25 },
  T50x30_rect: { vbW: 50, vbH: 30, bodyW: 50, bodyH: 30 },
}

function getMeta(key: JewelryLabelSizeKey | "T50x30_rect"): ShapeMeta {
  return META[key] ?? META.T25x30_45
}

/** Поле вокруг бумаги (экранные px) — место под тень */
const PAD = 24

/** Ширина хвостика бирки, мм */
const TAIL_W_MM = 3

// ---------------------------------------------------------------------------
// Раскладка: размер SVG и позиция Fabric-холста внутри него
// ---------------------------------------------------------------------------
export function getSvgLayout(
  key: JewelryLabelSizeKey | "T50x30_rect",
  sizeDef: LabelSizeDef
): { svgW: number; svgH: number; canvasX: number; canvasY: number; pxPerMm: number } {
  const m = getMeta(key)
  const pxPerMm = Math.min(sizeDef.w_px / m.bodyW, sizeDef.h_px / m.bodyH)

  return {
    svgW: Math.round(m.vbW * pxPerMm + PAD * 2),
    svgH: Math.round(m.vbH * pxPerMm + PAD * 2),
    canvasX: PAD,
    canvasY: PAD,
    pxPerMm,
  }
}

/**
 * Размер тела бирки (печатная зона без хвостика) в пикселях холста.
 * Макет строится по этим размерам, чтобы текст не уезжал на хвостик.
 */
export function getBodyPx(sizeDef: LabelSizeDef): { w: number; h: number } {
  const key = sizeDef.key as JewelryLabelSizeKey | "T50x30_rect"
  const m = getMeta(key)
  const { pxPerMm } = getSvgLayout(key, sizeDef)
  return { w: Math.round(m.bodyW * pxPerMm), h: Math.round(m.bodyH * pxPerMm) }
}

// ---------------------------------------------------------------------------
// Общие элементы вектора (координатная система Inkscape: 113.386 × 264.567)
// ---------------------------------------------------------------------------
function TagBody() {
  return (
    <>
      {/* Левая половина */}
      <path
        d="M 52.9134,0 H 3.77953 C 1.69215,0 0,1.69215 0,3.77953 V 90.7087 c 0,2.0873 1.69215,3.7795 3.77953,3.7795 H 52.9134 c 2.0874,0 3.7795,-1.6922 3.7795,-3.7795 V 3.77953 C 56.6929,1.69215 55.0008,0 52.9134,0 Z"
        fill="#d9d9d9"
      />
      {/* Правая половина */}
      <path
        d="M 109.606,0 H 60.4724 C 58.3851,0 56.6929,1.69215 56.6929,3.77953 V 90.7087 c 0,2.0873 1.6922,3.7795 3.7795,3.7795 h 49.1336 c 2.088,0 3.78,-1.6922 3.78,-3.7795 V 3.77953 C 113.386,1.69215 111.694,0 109.606,0 Z"
        fill="#d9d9d9"
      />
      {/* Внутренние поля */}
      <path
        d="M 108.4,2 H 61.6 C 59.6118,2 58,3.62968 58,5.64 v 83.72 c 0,2.0103 1.6118,3.64 3.6,3.64 h 46.8 c 1.988,0 3.6,-1.6297 3.6,-3.64 V 5.64 C 112,3.62968 110.388,2 108.4,2 Z"
        fill="#030303"
        fillOpacity={0.21}
      />
      <path
        d="M 51.4,2 H 4.6 C 2.61177,2 1,3.62968 1,5.64 V 89.36 C 1,91.3703 2.61177,93 4.6,93 H 51.4 C 53.3882,93 55,91.3703 55,89.36 V 5.64 C 55,3.62968 53.3882,2 51.4,2 Z"
        fill="#030303"
        fillOpacity={0.21}
      />
      {/* Линия сгиба */}
      <path
        d="M 56.6929,3.77954 V 90.7087"
        stroke="#acacac"
        strokeWidth={0.5}
        strokeDasharray="1, 1"
      />
    </>
  )
}

/** T25*30+45 — исходный вектор повернут на 90°, хвостик вниз */
function ShapeT25x30_45() {
  return (
    <g transform="translate(-0.05418377,-0.05661559)">
      <g
        style={{ fill: "none" }}
        transform="matrix(0,0.26475095,-0.26564233,0,25.179054,0.05661559)"
      >
        <g clipPath="url(#clip-t25)">
          <TagBody />
        </g>
      </g>
    </g>
  )
}

/** T30*25+45 и T30*25+50 — исходный вектор без поворота, хвостик вниз */
function ShapeT30x25() {
  return (
    <g
      style={{ fill: "none" }}
      transform="matrix(0.26440201,8.1001016e-4,0,0.26458333,0.00417149,-0.06087156)"
    >
      <g clipPath="url(#clip-t30)">
        <TagBody />
      </g>
    </g>
  )
}

/** Прямоугольник 50x30 без хвостика */
function ShapeT50x30_rect() {
  return (
    <g
      style={{ fill: "none" }}
      transform="matrix(0.26440201,8.1001016e-4,0,0.26458333,0.00417149,-0.06087156)"
    >
      <g clipPath="url(#clip-t30)">
        {/* <TagBody /> */}
        {/* Прямоугольник 50x30 без хвостика */}
        {/* <path d="M 79.3701,94.4882 H 109.3701 V 244.567 H 79.3701 z" fill="#d9d9d9" /> */}
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------
// Экспорт
// ---------------------------------------------------------------------------
interface BgProps {
  sizeDef: LabelSizeDef
  className?: string
  /** Показывать синюю пунктирную рамку печатной области */
  showPrintArea?: boolean
}

export function LabelBackground({ sizeDef, className, showPrintArea = true }: BgProps) {
  const key = (sizeDef.key as JewelryLabelSizeKey | "T50x30_rect") ?? "T25x30_45"
  const m = getMeta(key)
  const { svgW, svgH, pxPerMm } = getSvgLayout(key, sizeDef)

  // Поле в единицах viewBox (мм)
  const padMm = PAD / pxPerMm

  return (
    <div className={className} style={{ pointerEvents: "none", userSelect: "none" }}>
      <svg
        width={svgW}
        height={svgH}
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
          {key === "T30x25_50" || key === "T30x25_45" ? (
            <ShapeT30x25 />
          ) : key === "T50x30_rect" ? (
            <ShapeT50x30_rect />
          ) : (
            <ShapeT25x30_45 />
          )}
          {/* Хвостик — рисуем в мм-координатах, чтобы длина всегда совпадала
              с реальным форматом (T…+45 / T…+50) */}
          {m.vbH > m.bodyH && (
            <rect
              x={(m.vbW - TAIL_W_MM) / 2}
              y={m.bodyH}
              width={TAIL_W_MM}
              height={m.vbH - m.bodyH}
              fill="#d9d9d9"
            />
          )}
        </g>

        {showPrintArea && (
          <rect
            x={0.15}
            y={0.15}
            width={m.bodyW - 0.3}
            height={m.bodyH - 0.3}
            fill="none"
            stroke="#2563eb"
            strokeWidth={0.25}
            strokeDasharray="1.2,1"
          />
        )}
      </svg>
    </div>
  )
}