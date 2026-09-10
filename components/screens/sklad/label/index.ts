// ---------------------------------------------------------------------------
// Публичное API модуля sklad/label
// ---------------------------------------------------------------------------

// Главный компонент
export { LabelEditor } from "./label-editor"

// Типы
export type { LabelEditorProps, LabelTemplate, TemplateItem } from "./types"

// Константы (для внешних потребителей)
export {
  ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, ZOOM_STEP,
  RULER_SIZE,
  FONTS,
  BORDER_STYLES,
  TEMPLATE_VERSION,
  LIVE_ROLES,
  AUTOFIT_MIN_FONT, AUTOFIT_MAX_FONT,
  FIT_RATIO_MIN, FIT_RATIO_MAX, FIT_RATIO_DEFAULT,
  PRINT_SCALE,
} from "./constants"
export type { BorderStyleKey } from "./constants"

// Утилиты (нужны тестам и смежным модулям)
export { buildJewelryText }   from "./data/jewelry-text"
export { buildQrUrl }         from "./data/qr"
export { serializeLayout, parseTemplate, applyTemplate } from "./data/template"
export { fitFontToBox, fitTextboxHeight, refitTextbox, createTextbox } from "./canvas/text-fit"
export { cropPrintArea }      from "./canvas/print"
