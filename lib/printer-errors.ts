function readError(error: unknown): { message: string; name: string } {
  const message = error instanceof Error ? error.message
    : typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error ?? "")
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : ""
  return { message: message.trim(), name }
}

/**
 * iOS Web Bluetooth browsers (Bluefy) reject GATT calls with the bare
 * CoreBluetooth error code, e.g. "2" (CBError.invalidHandle) when the cached
 * characteristic belongs to an older connection. Such a code — or any
 * dropped-link error — means the BLE session must be rebuilt and the print can
 * be retried safely: nothing was sent to the printhead yet.
 */
export function isStaleBluetoothLinkError(error: unknown): boolean {
  const { message, name } = readError(error)
  // The paper was already fed out — retrying would print a duplicate label.
  if (/print not confirmed/i.test(message)) return false
  if (/user cancelled|no device selected|device selection.*cancel/i.test(message)) return false
  if (/^-?\d+$/.test(message)) return true
  if (name === "NetworkError" || name === "InvalidStateError") return true
  return /\bGATT\b|invalid handle|not connected|disconnected|Failed to write to BLE|buffer full|unknown reason|connection (?:failed|timed out|timeout)|CBErrorDomain|CBATTErrorDomain/i.test(message)
}

/** Keep chooser cancellation distinct from missing GATT services/characteristics. */
export function getPrintErrorMessage(error: unknown): string {
  const { message, name } = readError(error)

  if (name === "DejenPrintError" || name === "DejenConnectionError" || name === "PrinterChooserCancelled") {
    return message
  }
  if (/user cancelled the requestdevice(?:\(\))? chooser|no device selected|device selection.*cancel/i.test(message)) {
    return "Принтер не выбран. Включите Bluetooth, выберите принтер в окне браузера и повторите печать."
  }
  if (/^-?\d+$/.test(message)) {
    return `Связь с принтером прервалась (код ${message}). Выключите и включите принтер, затем повторите печать.`
  }
  if (name === "NotFoundError") {
    return `Не найден Bluetooth-ресурс принтера. Это не обязательно отмена выбора устройства. ${message}`.trim()
  }
  if (name === "NotAllowedError") {
    return "Браузеру не разрешён доступ к Bluetooth. Разрешите подключение и выберите принтер."
  }
  if (name === "NetworkError" || /\bGATT\b|disconnected|not connected/i.test(message)) {
    return "Не удалось подключиться к принтеру. Проверьте, что он включён и находится рядом, затем повторите печать."
  }
  return message || "Ошибка при печати"
}
