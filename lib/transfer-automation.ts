import puppeteer, { type Page, type Browser, type Frame } from "puppeteer-core"
import type { TransferEntry } from "./transfer-types"
import {
  chromePath,
  delay,
  normalizeDateToDDMMYYYY,
  screenshot,
  debugVisibleText,
  clickByText,
  loginGalicia,
  acceptTermsIfPresent,
  clickPrepareAndAuthorize,
  waitForOtpScreen,
  enterOtpCode,
  waitForBankSuccess,
  VIEWPORT,
} from "./bank-automation"

const DEBUG_MODE = (process.env.ECHECK_DEBUG ?? "0") === "1"
const FAST_MODE = (process.env.ECHECK_FAST ?? "1") === "1"
const KEY_DELAY_MS = Number(process.env.ECHECK_KEY_DELAY_MS ?? (FAST_MODE ? 5 : 50))
const POST_FIELD_DELAY_MS = Number(process.env.ECHECK_POST_FIELD_DELAY_MS ?? (FAST_MODE ? 150 : 800))
const AFTER_FILLED_DELAY_MS = Number(process.env.ECHECK_AFTER_FILLED_DELAY_MS ?? (FAST_MODE ? 200 : 1500))

// Module-level browser reference to reuse between batches
// When manualOtp leaves the browser open, subsequent calls can reconnect
let _sharedBrowser: Browser | null = null

function logDebug(logs: string[], msg: string) {
  if (DEBUG_MODE) logs.push(msg)
}

export interface TransferAutomationResult {
  success: boolean
  transferId: string
  error?: string
}

export interface TransferBatchAutomationResult {
  results: TransferAutomationResult[]
  totalSent: number
  totalFailed: number
  logs: string[]
  bankOperationId?: string
  }

/**
 * Navigate to Transferencias > Nueva transferencia
 */
async function navegarNuevaTransferencia(page: Page, logs: string[]) {
  logs.push("Esperando que cargue el dashboard...")
  await delay(6000)
  await debugVisibleText(page, logs)
  await screenshot(page, "tf-02-dashboard", logs)

  // Click "Transferencias"
  logs.push("Buscando menu 'Transferencias'...")
  const clickedTransf = await clickByText(page, /^Transferencias$/i, "Transferencias", logs)
  if (!clickedTransf) {
    await screenshot(page, "tf-03-transferencias-not-found", logs)
    throw new Error("No se encontro el menu 'Transferencias' en la pagina")
  }

  logs.push("Click en Transferencias realizado. Esperando submenu...")
  await delay(7000)
  await debugVisibleText(page, logs)
  await screenshot(page, "tf-04-after-transferencias", logs)

  // Click "Nueva transferencia"
  logs.push("Buscando 'Nueva transferencia'...")
  const clickedNueva = await clickByText(page, /nueva transferencia/i, "Nueva transferencia", logs)
  if (!clickedNueva) {
    const alt1 = await clickByText(page, /nueva\s+transf/i, null, logs)
    if (!alt1) {
      const alt2 = await clickByText(page, /crear\s+transferencia/i, null, logs)
      if (!alt2) {
        await screenshot(page, "tf-05-nueva-not-found", logs)
        throw new Error("No se encontro 'Nueva transferencia' en el submenu de Transferencias")
      }
    }
  }

  logs.push("Click en Nueva transferencia realizado. Esperando formulario...")
  await delay(7000)
  await debugVisibleText(page, logs)
  await screenshot(page, "tf-06-formulario-transferencia", logs)
  logs.push("En pantalla de nueva transferencia.")
}

/**
 * Find the iframe that contains the transfer form.
 */
async function findTransferFormFrame(page: Page, logs: string[]): Promise<Frame | null> {
  for (const frame of page.frames()) {
    try {
      const hasForm = await frame.evaluate(() => {
        // Check for known input names from the bank's form
        const knownNames = [
          "new-transf-execution-date",
          "new-transf-destination-account",
          "new-transf-document",
          "new-transf-amount",
        ]
        const hasKnownInput = knownNames.some((n) => document.querySelector(`input[name="${n}"]`))
        if (hasKnownInput) return true
        // Fallback: check for Spanish text
        const text = (document.body?.innerText || "").toLowerCase()
        const hasTransferText = text.includes("cuenta destino") || text.includes("transferencia")
        const inputs = Array.from(document.querySelectorAll("input"))
        const hasTransferInput = inputs.some((i) => {
          const n = (i.name || "").toLowerCase()
          const lt = (i.getAttribute("labeltext") || "").toLowerCase()
          return n.includes("destination") || n.includes("destino") || n.includes("monto") || n.includes("amount") ||
            lt.includes("destino") || lt.includes("cbu") || lt.includes("monto")
        })
        return hasTransferText || hasTransferInput
      })
      if (hasForm) {
        logs.push(`[iframe] Formulario de transferencia encontrado en frame: ${frame.url()}`)
        return frame
      }
    } catch {
      // iframe not accessible
    }
  }

  // Fallback: check main frame
  const mainHasForm = await page.evaluate(() => {
    const text = (document.body?.innerText || "").toLowerCase()
    return text.includes("cuenta destino") || text.includes("nueva transferencia")
  })
  if (mainHasForm) {
    logs.push("[iframe] Formulario de transferencia encontrado en main frame")
    return page.mainFrame()
  }

  logs.push("[WARN] No se encontro el formulario de transferencia en ningun frame")
  return null
}

/**
 * Fill the Nth matching input in the frame (fallback for when fillByName fails).
 * Searches by keywords in name/placeholder/labeltext attributes.
 */
async function fillNthInput(
  frame: Frame,
  keywords: string[],
  value: string,
  nth: number,
  fieldName: string,
  logs: string[]
): Promise<boolean> {
  logs.push(`Llenando "${fieldName}" (nth=${nth}, keywords=[${keywords.join(",")}]) con: "${value}"`)

  const found = await frame.evaluate(
    (args: { kws: string[]; n: number }) => {
      const { kws, n } = args
      // Collect ALL visible inputs
      const allInputs = Array.from(document.querySelectorAll("input")).filter(
        (i) => i.type !== "hidden" && !i.disabled && i.offsetParent !== null
      )

      // Find all inputs matching any keyword by name/placeholder/labeltext
      const matches: HTMLInputElement[] = []
      for (const inp of allInputs) {
        const nm = (inp.name || "").toLowerCase()
        const lt = (inp.getAttribute("labeltext") || "").toLowerCase()
        const ph = (inp.placeholder || "").toLowerCase()
        for (const kw of kws) {
          if (nm.includes(kw) || lt.includes(kw) || ph.includes(kw)) {
            matches.push(inp)
            break
          }
        }
      }

      if (n < matches.length) {
        const input = matches[n]
        input.scrollIntoView({ block: "center" })
        input.focus()
        input.click()
        // Clear via native setter
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set
        if (nativeSetter) nativeSetter.call(input, "")
        else input.value = ""
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
        return { ok: true, matchCount: matches.length }
      }

      return { ok: false, matchCount: matches.length }
    },
    { kws: keywords, n: nth }
  )

  if (!found.ok) {
    logs.push(
      `[WARN] No se encontro "${fieldName}" nth=${nth} (total matches por keyword: ${found.matchCount}). Intentando por label/text...`
    )
    // Fallback: search by label text near the Nth matching container
    const labelFallback = await frame.evaluate(
      (args: { kws: string[]; n: number }) => {
        const { kws, n } = args
        let matchIdx = 0
        // Search spans/divs that contain the keyword text, then find nearby inputs
        const textEls = Array.from(document.querySelectorAll("span, div, p, label, th, td"))
        for (const el of textEls) {
          const text = ((el as HTMLElement).innerText || "").toLowerCase().trim()
          if (text.length > 60) continue
          for (const kw of kws) {
            if (text.includes(kw)) {
              const container = el.closest("div, td, th, fieldset, li")
              const input = container?.querySelector("input:not([type=hidden]):not(:disabled)") as HTMLInputElement | null
              if (input && input.offsetParent !== null) {
                if (matchIdx === n) {
                  input.scrollIntoView({ block: "center" })
                  input.focus()
                  input.click()
                  const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value"
                  )?.set
                  if (nativeSetter) nativeSetter.call(input, "")
                  else input.value = ""
                  input.dispatchEvent(new Event("input", { bubbles: true }))
                  input.dispatchEvent(new Event("change", { bubbles: true }))
                  return true
                }
                matchIdx++
              }
              break
            }
          }
        }
        return false
      },
      { kws: keywords, n: nth }
    )

    if (!labelFallback) {
      logs.push(`[WARN] No se pudo llenar "${fieldName}" con ninguna estrategia.`)
      return false
    }
  }

  // Type the value character by character into the focused element
  // Note: frame.page() can return null; we get the page from the caller's context
  const pageRef = frame.page()
  if (!pageRef) {
    logs.push(`[WARN] frame.page() returned null for "${fieldName}". Cannot type.`)
    return false
  }
  await pageRef.keyboard.type(value, { delay: KEY_DELAY_MS })
  await delay(POST_FIELD_DELAY_MS)
  return true
}

/** Known input name for the date field */
const DATE_INPUT_NAME = "new-transf-execution-date"

/**
 * Set the "Fecha de envio" field by interacting with the calendar popup.
 *
 * The bank's date picker is a React calendar widget. The input shows the selected
 * date but ONLY accepts values by clicking a day in the calendar popup.
 * All programmatic value changes (native setter, React fiber onChange, keyboard)
 * are reverted when the calendar closes.
 *
 * Strategy:
 *   1. Click the date input to open the calendar popup
 *   2. Navigate to the correct month/year using the calendar arrows
 *   3. Click the target day number button in the calendar grid
 */
async function setTransferDate(
  page: Page,
  formFrame: Frame,
  dateValueRaw: string,
  logs: string[]
): Promise<void> {
  const dateValue = normalizeDateToDDMMYYYY(dateValueRaw)
  logs.push(`Llenando "Fecha de envio" con: ${dateValue} (raw: "${dateValueRaw}")`)

  // Parse target date
  const parts = dateValue.split("/")
  const targetDay = parseInt(parts[0], 10)
  const targetMonth = parseInt(parts[1], 10) // 1-based
  const targetYear = parseInt(parts[2], 10)
  logs.push(`[date] Target: dia=${targetDay}, mes=${targetMonth}, anio=${targetYear}`)

  const selector = `input[name="${DATE_INPUT_NAME}"]`

  // Read current value
  const currentVal = await formFrame.evaluate((sel: string) => {
    const input = document.querySelector(sel) as HTMLInputElement | null
    if (!input) {
      const fb = document.querySelector('input[placeholder*="echa" i]') as HTMLInputElement | null
      if (fb) return { found: true, value: fb.value, name: fb.name }
      return { found: false, value: "", name: "" }
    }
    return { found: true, value: input.value, name: input.name }
  }, selector)

  if (!currentVal.found) {
    logs.push("[WARN] No se encontro el campo de fecha de envio")
    return
  }
  logs.push(`[date] Campo encontrado: value="${currentVal.value}"`)

  if (currentVal.value === dateValue) {
    logs.push(`[date] Fecha ya tiene el valor correcto: "${currentVal.value}"`)
    return
  }

  // Step 1: Click the date input to open the calendar
  await formFrame.evaluate((sel: string) => {
    const input = document.querySelector(sel) as HTMLInputElement | null
      ?? document.querySelector('input[placeholder*="echa" i]') as HTMLInputElement | null
    if (input) {
      input.scrollIntoView({ block: "center" })
      input.click()
    }
  }, selector)
  await delay(800)

  // Step 2: Read current calendar month/year and navigate if needed
  const MONTH_NAMES: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  }

  // Navigate the calendar to the target month
  for (let navAttempt = 0; navAttempt < 24; navAttempt++) {
    const calInfo = await formFrame.evaluate((monthMap: Record<string, number>) => {
      // Find the calendar header -- look for text like "Febrero 2026"
      // Search for elements containing month+year text near the date input
      const candidates = Array.from(document.querySelectorAll("span, div, button, p, h2, h3, h4"))
      for (const el of candidates) {
        const text = ((el as HTMLElement).innerText || "").trim().toLowerCase()
        // Match patterns like "febrero 2026" or "February 2026"
        for (const [monthName, monthNum] of Object.entries(monthMap)) {
          const regex = new RegExp(`${monthName}\\s+(\\d{4})`, "i")
          const match = text.match(regex)
          if (match) {
            return { month: monthNum, year: parseInt(match[1], 10), headerText: text }
          }
        }
      }
      return null
    }, MONTH_NAMES)

    if (!calInfo) {
      logs.push(`[date] No se pudo leer el mes/anio del calendario (intento ${navAttempt + 1})`)
      if (navAttempt === 0) {
        // Calendar might not be open, try clicking again
        await formFrame.evaluate((sel: string) => {
          const input = document.querySelector(sel) as HTMLInputElement | null
            ?? document.querySelector('input[placeholder*="echa" i]') as HTMLInputElement | null
          if (input) input.click()
        }, selector)
        await delay(800)
        continue
      }
      break
    }

    logs.push(`[date] Calendario muestra: mes=${calInfo.month}, anio=${calInfo.year} (header: "${calInfo.headerText}")`)

    const currentCalMonth = calInfo.year * 12 + calInfo.month
    const targetCalMonth = targetYear * 12 + targetMonth

    if (currentCalMonth === targetCalMonth) {
      // We're on the right month -- click the day
      logs.push(`[date] Mes correcto. Buscando dia ${targetDay}...`)
      break
    }

    // Need to navigate: click next (>) or previous (<) arrow
    const direction = targetCalMonth > currentCalMonth ? "next" : "prev"
    const clicksNeeded = Math.abs(targetCalMonth - currentCalMonth)
    logs.push(`[date] Navegando ${direction} ${clicksNeeded} mes(es)...`)

    const clicked = await formFrame.evaluate((dir: string) => {
      // Look for navigation arrows -- typically buttons with < or > or aria-label containing "next"/"previous"
      const arrows = Array.from(document.querySelectorAll("button, [role='button'], span, a"))
      for (const el of arrows) {
        const text = ((el as HTMLElement).innerText || "").trim()
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase()
        const title = (el.getAttribute("title") || "").toLowerCase()

        if (dir === "next") {
          if (text === ">" || text === "\u203A" || text === "\u276F" || text === "\u25B6" ||
              ariaLabel.includes("next") || ariaLabel.includes("siguiente") ||
              title.includes("next") || title.includes("siguiente")) {
            ;(el as HTMLElement).click()
            return true
          }
        } else {
          if (text === "<" || text === "\u2039" || text === "\u276E" || text === "\u25C0" ||
              ariaLabel.includes("prev") || ariaLabel.includes("anterior") ||
              title.includes("prev") || title.includes("anterior")) {
            ;(el as HTMLElement).click()
            return true
          }
        }
      }

      // Fallback: look for SVG icons inside buttons (common in React date pickers)
      const btns = Array.from(document.querySelectorAll("button"))
      // Usually the arrows are small buttons near the calendar header
      // They often come in pairs; the first is "prev", the second is "next"
      const arrowBtns = btns.filter((b) => {
        const rect = b.getBoundingClientRect()
        return rect.width > 0 && rect.width < 60 && rect.height > 0 && rect.height < 60 &&
          (b.querySelector("svg") || b.innerText.length <= 2)
      })
      if (arrowBtns.length >= 2) {
        const idx = dir === "prev" ? 0 : arrowBtns.length - 1
        arrowBtns[idx].click()
        return true
      }

      return false
    }, direction)

    if (!clicked) {
      logs.push(`[date][WARN] No se encontro boton de navegacion "${direction}" en el calendario`)
      break
    }

    await delay(500)
  }

  // Step 3: Click the target day number
  await delay(300)
  const dayClicked = await formFrame.evaluate((day: number) => {
    // Find all day buttons/cells in the calendar
    // Look for elements that contain EXACTLY the day number as text
    const dayStr = String(day)
    const candidates = Array.from(document.querySelectorAll("button, td, div[role='button'], span[role='button'], [role='gridcell']"))

    // First pass: look for exact match buttons with the day text
    for (const el of candidates) {
      const text = ((el as HTMLElement).innerText || "").trim()
      if (text === dayStr) {
        // Make sure it's inside a calendar context (not some random button)
        const parent = el.closest("[class*='calendar'], [class*='datepicker'], [class*='Calendar'], [class*='picker'], [role='grid'], [role='dialog']")
          || el.closest("table")
        if (parent) {
          ;(el as HTMLElement).click()
          return { clicked: true, method: "exact-in-calendar" }
        }
      }
    }

    // Second pass: look for <td> or buttons containing the day inside a table (calendar grid)
    const tables = Array.from(document.querySelectorAll("table"))
    for (const table of tables) {
      // Check if this table has weekday headers (DOM, LUN, MAR...) - it's a calendar
      const headerText = (table.querySelector("thead, tr:first-child")?.textContent || "").toLowerCase()
      const isCalendar = /dom|lun|mar|mie|jue|vie|sab|sun|mon|tue|wed|thu|fri|sat/i.test(headerText)
      if (!isCalendar) continue

      const cells = Array.from(table.querySelectorAll("td, button"))
      for (const cell of cells) {
        const text = ((cell as HTMLElement).innerText || "").trim()
        if (text === dayStr) {
          ;(cell as HTMLElement).click()
          return { clicked: true, method: "table-cell" }
        }
      }
    }

    // Third pass: any element with exact day text that's inside any popup/overlay
    const popups = Array.from(document.querySelectorAll("[class*='popup'], [class*='overlay'], [class*='dropdown'], [class*='popover'], [class*='modal'], [class*='Popup'], [class*='Overlay'], [class*='Dropdown'], [class*='Popover']"))
    for (const popup of popups) {
      const els = Array.from(popup.querySelectorAll("button, td, div, span, a"))
      for (const el of els) {
        const text = ((el as HTMLElement).innerText || "").trim()
        if (text === dayStr) {
          ;(el as HTMLElement).click()
          return { clicked: true, method: "popup-element" }
        }
      }
    }

    // Fourth pass: brute force -- find any clickable element with just the day number
    // But only if it's visually positioned in the calendar area
    const allEls = Array.from(document.querySelectorAll("button, td, [role='button'], [tabindex]"))
    for (const el of allEls) {
      const text = ((el as HTMLElement).innerText || "").trim()
      const rect = (el as HTMLElement).getBoundingClientRect()
      if (text === dayStr && rect.width > 0 && rect.width < 80 && rect.height > 0 && rect.height < 80) {
        // Likely a calendar day cell
        ;(el as HTMLElement).click()
        return { clicked: true, method: "brute-force" }
      }
    }

    return { clicked: false, method: "none" }
  }, targetDay)

  logs.push(`[date] Click dia ${targetDay}: clicked=${dayClicked.clicked}, method="${dayClicked.method}"`)
  await delay(500)

  // Verify the final value
  const finalVal = await formFrame.evaluate((sel: string) => {
    const input = document.querySelector(sel) as HTMLInputElement | null
      ?? document.querySelector('input[placeholder*="echa" i]') as HTMLInputElement | null
    return input?.value || ""
  }, selector)
  logs.push(`[date] Valor final de fecha: "${finalVal}" (esperado: "${dateValue}")`)

  if (finalVal !== dateValue) {
    logs.push(`[date][WARN] La fecha no coincide. Puede que el calendario no permita seleccionar esa fecha.`)
  }

  // Close popover if still open
  await page.keyboard.press("Escape").catch(() => {})
  await delay(200)
}

/**
 * Known input names from the bank's form.
 * These were discovered from production debugging.
 */
const KNOWN_INPUTS = {
  date: "new-transf-execution-date",
  destination: "new-transf-destination-account",
  cuit: "new-transf-document",
  description: "new-transf-description",
  amount: "new-transf-amount",
}

/**
 * Fill a known input field by its name attribute, targeting a specific row.
 *
 * The bank form is MULTI-ROW: "Agregar otra transferencia" adds a new row
 * with the SAME name attributes. We use querySelectorAll and index by `rowIndex`
 * to target the correct row (0 = first row, 1 = second row, etc.).
 *
 * Clears existing text via Ctrl+A + Backspace (React-safe),
 * then keyboard.type() to enter the new value.
 * Returns true if the field was found and filled.
 */
async function fillByName(
  page: Page,
  frame: Frame,
  inputName: string,
  value: string,
  fieldLabel: string,
  logs: string[],
  rowIndex: number = 0
): Promise<boolean> {
  if (!value && value !== "0") {
    logs.push(`[fill] "${fieldLabel}" (name=${inputName}, row=${rowIndex}): valor vacio, saltando.`)
    return false
  }

  const found = await frame.evaluate(
    (args: { name: string; row: number }) => {
      const inputs = Array.from(document.querySelectorAll(`input[name="${args.name}"]`)) as HTMLInputElement[]
      const input = inputs[args.row]
      if (!input || !input.offsetParent) return { ok: false, disabled: false, currentValue: "", totalRows: inputs.length }
      if (input.disabled) return { ok: false, disabled: true, currentValue: input.value, totalRows: inputs.length }

      input.scrollIntoView({ block: "center" })
      input.focus()
      input.click()
      return { ok: true, disabled: false, currentValue: input.value, totalRows: inputs.length }
    },
    { name: inputName, row: rowIndex }
  )

  if (!found.ok) {
    if (found.disabled) {
      logs.push(`[fill] "${fieldLabel}" (name=${inputName}, row=${rowIndex}/${found.totalRows}) esta deshabilitado, saltando.`)
    } else {
      logs.push(`[WARN] No se encontro "${fieldLabel}" (name=${inputName}, row=${rowIndex}/${found.totalRows}).`)
      return false
    }
    return false
  }

  // Clear existing text using input.select() + Backspace
  // We use frame.evaluate to select text WITHIN the specific input (not page-wide Ctrl+A
  // which can affect other fields like the date picker)
  await delay(100)

  // Select all text within the focused input via DOM API
  await frame.evaluate(
    (args: { name: string; row: number }) => {
      const inputs = Array.from(document.querySelectorAll(`input[name="${args.name}"]`)) as HTMLInputElement[]
      const input = inputs[args.row]
      if (input) {
        input.focus()
        input.select() // Select all text within THIS input only
      }
    },
    { name: inputName, row: rowIndex }
  )
  await delay(50)
  await page.keyboard.press("Backspace")
  await delay(100)

  // Verify cleared
  const afterClear = await frame.evaluate(
    (args: { name: string; row: number }) => {
      const inputs = Array.from(document.querySelectorAll(`input[name="${args.name}"]`)) as HTMLInputElement[]
      return inputs[args.row]?.value || ""
    },
    { name: inputName, row: rowIndex }
  )

  // If not cleared, try triple-click + Backspace as fallback
  if (afterClear.length > 0) {
    const allEls = await frame.$$(`input[name="${inputName}"]`)
    const el = allEls[rowIndex]
    if (el) {
      await el.click({ clickCount: 3 })
      await delay(50)
    }
    await page.keyboard.press("Backspace")
    await delay(100)
  }

  // Type the value
  const safeValue = String(value)
  await page.keyboard.type(safeValue, { delay: KEY_DELAY_MS })
  await delay(POST_FIELD_DELAY_MS)

  // Verify the value was set
  const finalVal = await frame.evaluate(
    (args: { name: string; row: number }) => {
      const inputs = Array.from(document.querySelectorAll(`input[name="${args.name}"]`)) as HTMLInputElement[]
      return inputs[args.row]?.value || ""
    },
    { name: inputName, row: rowIndex }
  )

  if (finalVal.includes(safeValue)) {
    logs.push(`[fill] "${fieldLabel}" (row ${rowIndex}): "${safeValue}" OK (actual: "${finalVal}")`)
  } else {
    logs.push(`[fill][WARN] "${fieldLabel}" (row ${rowIndex}): esperado "${safeValue}", actual "${finalVal}"`)
  }
  return true
}

/**
 * Fill a single transfer's data into the bank form.
 *
 * The bank's form is MULTI-ROW: "Agregar otra transferencia" adds a new empty
 * row below the existing one. All rows share the same `name` attributes.
 * We use `rowIndex` to target the correct row (0-based).
 *
 * Date is NOT set here -- it is set ONCE per batch before any transfers are filled.
 * The bank applies the same "Fecha de envio" to ALL transfers in a batch.
 */
async function llenarTransferencia(
  page: Page,
  formFrame: Frame,
  transfer: TransferEntry,
  index: number,
  rowIndex: number,
  logs: string[]
) {
  logs.push(
    `--- Transferencia ${index + 1} (fila ${rowIndex}): ${transfer.providerName} ` +
    `(CUIT: ${transfer.cuitNumber}, CBU: ${transfer.cbu}, ` +
    `Monto: ${transfer.amount}) ---`
  )

  // Debug: dump all visible inputs
  const inputInfo = await formFrame.evaluate(() => {
    return Array.from(document.querySelectorAll("input"))
      .filter((i) => i.type !== "hidden")
      .map((i, idx) => ({
        idx,
        name: i.name,
        id: i.id,
        type: i.type,
        placeholder: i.placeholder,
        labeltext: i.getAttribute("labeltext"),
        value: i.value,
        visible: i.offsetParent !== null,
        disabled: i.disabled,
      }))
  })
  logDebug(logs, `[debug] Inputs en formulario (transfer ${index + 1}): ${JSON.stringify(inputInfo)}`)

  // a) Cuenta destino (CBU/alias) -- fill FIRST so CBU lookup can resolve
  await fillByName(page, formFrame, KNOWN_INPUTS.destination, transfer.cbu, "Cuenta destino / CBU", logs, rowIndex)

  // Wait for CBU autocomplete to resolve (the bank looks up the CBU and auto-fills CUIT)
  await delay(2000)

  // b) CUIT/CUIL -- the bank MAY auto-fill from CBU lookup. Fill only if not disabled.
  if (transfer.cuitNumber) {
    await fillByName(page, formFrame, KNOWN_INPUTS.cuit, transfer.cuitNumber, "CUIT/CUIL", logs, rowIndex)
  }

  // c) Concepto -- select dropdown (react-select). Skip for now, defaults to "Varios".

  // d) Descripcion
  if (transfer.providerName) {
    await fillByName(page, formFrame, KNOWN_INPUTS.description, transfer.providerName, "Descripcion", logs, rowIndex)
  }

  // e) Monto
  const montoStr = String(transfer.amount).replace(".", ",")
  await fillByName(page, formFrame, KNOWN_INPUTS.amount, montoStr, "Monto", logs, rowIndex)

  // Safety: close any remaining popovers
  await page.keyboard.press("Escape").catch(() => {})
  await delay(200)

  // Verify: re-read values in THIS row after fill
  const afterFill = await formFrame.evaluate((row: number) => {
    // Collect value of each known field at the given row index
    const names = [
      "new-transf-destination-account",
      "new-transf-document",
      "new-transf-description",
      "new-transf-amount",
    ]
    return names.map((name) => {
      const inputs = Array.from(document.querySelectorAll(`input[name="${name}"]`)) as HTMLInputElement[]
      const input = inputs[row]
      return {
        name,
        row,
        value: input?.value || "",
        disabled: input?.disabled || false,
      }
    })
  }, rowIndex)
  logs.push(`[debug] Valores fila ${rowIndex} despues de llenar: ${JSON.stringify(afterFill)}`)

  await delay(AFTER_FILLED_DELAY_MS)
  await screenshot(page, `tf-07-transfer-${index + 1}-filled`, logs)
  logs.push(`Transferencia ${index + 1} (fila ${rowIndex}) para ${transfer.providerName} completada.`)
}

/**
 * Click "Agregar otra transferencia" button.
 * Uses Puppeteer's native click (real mouse events) instead of JS .click()
 * because the bank's React app requires real DOM events to trigger its handlers.
 */
async function clickAgregarOtraTransferencia(page: Page, formFrame: Frame, logs: string[]): Promise<boolean> {
  // Try inside iframe first -- get the element's bounding box and use real click
  try {
    const bbox = await formFrame.evaluate(() => {
      const re = /agregar\s+(otra\s+)?transferencia/i
      // Look for the clickable element
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div, p')) as HTMLElement[]
      for (const n of nodes) {
        const txt = (n.innerText || '').trim()
        if (!re.test(txt) || txt.length > 80) continue
        // Prefer the closest button/link ancestor
        const btn = n.closest('button, [role="button"], a') as HTMLElement | null
        const target = btn || n
        target.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = target.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true }
        }
      }
      return { x: 0, y: 0, found: false }
    })

    if (bbox.found) {
      // Use Puppeteer's real mouse click at the element center
      // For iframes, we need to offset by the iframe position
      const frameElement = await formFrame.frameElement()
      let offsetX = 0
      let offsetY = 0
      if (frameElement) {
        const frameBox = await frameElement.boundingBox()
        if (frameBox) {
          offsetX = frameBox.x
          offsetY = frameBox.y
        }
      }
      await page.mouse.click(bbox.x + offsetX, bbox.y + offsetY)
      logs.push('[click] Agregar otra transferencia (mouse click en iframe)')
      await delay(500)

      // Also try JS click as backup to ensure React picks it up
      await formFrame.evaluate(() => {
        const re = /agregar\s+(otra\s+)?transferencia/i
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div, p')) as HTMLElement[]
        for (const n of nodes) {
          const txt = (n.innerText || '').trim()
          if (!re.test(txt) || txt.length > 80) continue
          const btn = n.closest('button, [role="button"], a') as HTMLElement | null
          const target = btn || n
          // Dispatch real mouse events
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          return
        }
      }).catch(() => {})

      return true
    }
  } catch { /* ignore */ }

  // Fallback: main page clickByText
  const clickedMain = await clickByText(page, /agregar\s+(otra\s+)?transferencia/i, null, logs)
  if (clickedMain) {
    logs.push('[click] Agregar otra transferencia (page clickByText)')
  }
  return clickedMain
}

/**
 * Click "Continuar" button
 */
async function clickContinuarTransferencia(page: Page, formFrame: Frame, logs: string[]): Promise<boolean> {
  // Close any popovers
  await page.keyboard.press("Escape").catch(() => {})
  await delay(200)

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) logs.push(`[retry] Reintentando click en 'continuar' (intento ${attempt}/3)...`)

    let clicked = false

    // Try inside form frame
    try {
      clicked = await formFrame.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"))
        for (const b of btns) {
          const text = (b as HTMLElement).innerText?.trim() || ""
          const disabled = (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true"
          if (/^continuar$/i.test(text) && !disabled) {
            b.scrollIntoView({ block: "center" })
            ;(b as HTMLElement).click()
            return true
          }
        }
        for (const b of btns) {
          const text = (b as HTMLElement).innerText?.trim() || ""
          const disabled = (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true"
          if (/continuar/i.test(text) && !disabled) {
            b.scrollIntoView({ block: "center" })
            ;(b as HTMLElement).click()
            return true
          }
        }
        const els = Array.from(document.querySelectorAll("a, span, div"))
        for (const el of els) {
          const text = (el as HTMLElement).innerText?.trim() || ""
          if (/^continuar$/i.test(text)) {
            ;(el as HTMLElement).scrollIntoView?.({ block: "center" } as any)
            ;(el as HTMLElement).click()
            return true
          }
        }
        return false
      })
    } catch { /* ignore */ }

    if (!clicked) {
      clicked = await clickByText(page, /continuar/i, null, logs)
    }

    if (!clicked) {
      await delay(400)
      continue
    }

    logs.push("[click] Intento de 'continuar' ejecutado")

    // Wait for progress
    const progressed = await page
      .waitForFunction(
        () => {
          const hasConfirmText = /confirmar|resumen|firmar|validar|preparar/i.test(document.body?.innerText || "")
          return hasConfirmText
        },
        { timeout: 12000 }
      )
      .then(() => true)
      .catch(() => false)

    if (progressed) return true

    await page.keyboard.press("Escape").catch(() => {})
    await delay(350)
  }

  return false
}

/**
 * Creates a logs array that calls an optional callback on every push.
 * This enables SSE streaming of logs in real-time.
 */
function createStreamingLogs(callback?: (line: string) => void): string[] {
  const arr: string[] = []
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === "push") {
        return (...args: string[]) => {
          const result = Array.prototype.push.apply(target, args)
          for (const line of args) {
            callback?.(line)
          }
          return result
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Main automation: login, navigate to transfers, set date ONCE, fill all transfers,
 * continue, authorize.
 *
 * IMPORTANT: All transfers in a single call MUST share the same date.
 * The bank applies "Fecha de envio" to the entire batch -- it does NOT support
 * different dates per transfer line.
 *
 * The caller (API route) is responsible for grouping transfers by date and
 * calling this function once per date group.
 *
 * @param transfers - All transfers for this batch (same date)
 * @param batchDate - The shared date for all transfers (DD/MM/YYYY or raw format)
 * @param options   - headless, manualOtp, logCallback
 */
export async function ejecutarTransferencias(
  transfers: TransferEntry[],
  batchDate: string,
  options?: {
    headless?: boolean
    manualOtp?: boolean
    isLastBatch?: boolean
    logCallback?: (line: string) => void
  }
): Promise<TransferBatchAutomationResult> {
  const user = process.env.GALICIA_USER
  const pass = process.env.GALICIA_PASS

  if (!user || !pass) {
    const errMsg = "ERROR: Faltan credenciales GALICIA_USER / GALICIA_PASS en .env"
    options?.logCallback?.(errMsg)
    return {
      results: transfers.map((t) => ({
        transferId: t.id,
        success: false,
        error: "Faltan GALICIA_USER o GALICIA_PASS en variables de entorno",
      })),
      totalSent: 0,
      totalFailed: transfers.length,
      logs: [errMsg],
    }
  }

  const normalizedDate = normalizeDateToDDMMYYYY(batchDate)
  const logs = createStreamingLogs(options?.logCallback)
  const results: TransferAutomationResult[] = []
  const manualOtp = options?.manualOtp ?? true
  let browser: Browser | null = null
  let shouldCloseBrowser = true
  let bankConfirmed = false
  let bankOperationId: string | undefined

  try {
    logs.push(`=== Lote de transferencias: ${transfers.length} transferencias para fecha ${normalizedDate} ===`)

    // Try to reuse existing browser (left open from previous batch with manual OTP)
    let reusingBrowser = false
    if (_sharedBrowser) {
      try {
        // Check if the shared browser is still alive
        const pages = await _sharedBrowser.pages()
        if (pages.length > 0) {
          browser = _sharedBrowser
          reusingBrowser = true
          logs.push("Reutilizando navegador existente de lote anterior.")
        }
      } catch {
        _sharedBrowser = null
      }
    }

    if (!browser) {
      logs.push("Abriendo navegador...")
      browser = await puppeteer.launch({
        headless: false,
        executablePath: chromePath(),
        defaultViewport: VIEWPORT,
        userDataDir: "./.chrome-galicia-transferencias",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
    }

    let page: Page
    if (reusingBrowser) {
      // Use the existing page (which should be on the bank's success page)
      const pages = await browser.pages()
      page = pages[pages.length - 1] || await browser.newPage()

      // Try clicking "Nueva transferencia" button on the success page first
      logs.push("Intentando click en 'Nueva transferencia' desde pantalla actual...")
      const clickedNueva = await clickByText(page, /nueva transferencia/i, "Nueva transferencia", logs)
      if (clickedNueva) {
        logs.push("Click en 'Nueva transferencia' exitoso. Esperando formulario...")
        await delay(5000)
      } else {
        // Fallback: navigate via URL
        logs.push("No se encontro boton. Navegando via URL...")
        await page.goto("https://empresas.bancogalicia.com.ar/transferencias/nueva-transferencia", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        })
        await delay(5000)
      }
    } else {
      page = await browser.newPage()
      // Step 1: Login (only needed for fresh browser)
      await loginGalicia(page, user, pass, logs)
    }

    // Step 2: Navigate to Transferencias > Nueva transferencia
    // Skip if reusing browser -- we already navigated above
    if (!reusingBrowser) {
      await navegarNuevaTransferencia(page, logs)
    }

    // Step 3: Find the form frame
    const formFrame = await findTransferFormFrame(page, logs)
    if (!formFrame) {
      const frameUrls = page.frames().map((f) => f.url())
      logs.push(`[debug] Frames disponibles: ${JSON.stringify(frameUrls)}`)
      throw new Error("No se encontro el formulario de transferencia en ningun iframe")
    }

    // Step 4: Fill each transfer in its own row.
    // NOTE: Date is set AFTER all transfers are filled (Step 5) because the bank's
    // React app clears the date field when transfer rows are modified or added.
    // Setting it last ensures it persists through to "Continuar".
    //
    // The bank form is MULTI-ROW: the first transfer uses row 0 (already visible).
    // After filling row N, we click "Agregar otra transferencia" which adds row N+1.
    // We then fill row N+1 for the next transfer.
    //
    // We count the destination inputs to track row count and wait for new rows.
    let currentRowIndex = 0

    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i]
      try {
        // Re-find the form frame (iframe reference may have changed)
        let currentFrame: Frame | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          currentFrame = await findTransferFormFrame(page, logs)
          if (currentFrame) break
          logs.push(`[retry] Reintentando encontrar frame de formulario (intento ${attempt + 2}/3)...`)
          await delay(2000)
        }
        if (!currentFrame) {
          throw new Error("No se encontro el formulario de transferencia despues de Agregar")
        }

        // Fill this transfer into the current row
        await llenarTransferencia(page, currentFrame, transfer, i, currentRowIndex, logs)

        if (i < transfers.length - 1) {
          // More transfers to add: click "Agregar otra transferencia"
          logs.push("Click en 'Agregar otra transferencia'...")
          const clickedAdd = await clickAgregarOtraTransferencia(page, currentFrame, logs)
          if (!clickedAdd) {
            await screenshot(page, `tf-08-agregar-not-found-${i + 1}`, logs)
            throw new Error(`No se encontro boton 'Agregar otra transferencia' para transferencia ${i + 1}`)
          }

          // Wait for the new row to appear by counting destination inputs
          const expectedRowCount = currentRowIndex + 2 // current rows + 1 new
          logs.push(`[agregar] Esperando nueva fila (esperando ${expectedRowCount} filas)...`)
          let newRowAppeared = false
          for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
            await delay(1000)
            const frame = await findTransferFormFrame(page, logs)
            if (!frame) continue
            const rowCount = await frame.evaluate((name: string) => {
              return document.querySelectorAll(`input[name="${name}"]`).length
            }, KNOWN_INPUTS.destination)
            if (rowCount >= expectedRowCount) {
              newRowAppeared = true
              logs.push(`[agregar] Nueva fila detectada (${rowCount} filas) despues de ${waitAttempt + 1}s`)
              break
            }
          }

          if (!newRowAppeared) {
            logs.push("[agregar][WARN] No se detecto nueva fila despues de 10s. Intentando llenar la siguiente de todos modos.")
            await screenshot(page, `tf-08b-no-new-row-${i + 1}`, logs)
          }

          currentRowIndex++
          await screenshot(page, `tf-09-transfer-${i + 1}-added`, logs)
        }

        results.push({ transferId: transfer.id, success: true })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        const stack = err instanceof Error ? err.stack : ""
        logs.push(`ERROR en transferencia ${transfer.providerName}: ${errorMsg}`)
        if (stack) logs.push(`[stack] ${stack}`)
        results.push({ transferId: transfer.id, success: false, error: errorMsg })
        await screenshot(page, `tf-error-transfer-${i + 1}`, logs).catch(() => {})
      }
    }

    // Step 5: Set the batch date AFTER all transfers are filled
    // The bank's React app clears the date when rows are added/modified,
    // so we set it last to ensure it persists through to "Continuar".
    const okCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length
    if (okCount === 0) {
      logs.push("[WARN] No se agrego ninguna transferencia; no se hara click en 'continuar'.")
      return { results, totalSent: okCount, totalFailed: failCount, logs }
    }
    if (failCount > 0) {
      logs.push("[WARN] Hubo errores cargando transferencias; no se continuara.")
      return { results, totalSent: okCount, totalFailed: failCount, logs }
    }

    const dateFrame = (await findTransferFormFrame(page, logs)) || formFrame
    logs.push(`[date] Seteando fecha del lote (despues de llenar filas): ${normalizedDate}`)
    try {
      await setTransferDate(page, dateFrame, normalizedDate, logs)
    } catch (dateErr) {
      const msg = dateErr instanceof Error ? dateErr.message : String(dateErr)
      logs.push(`[date][ERROR] No se pudo setear la fecha: ${msg}`)
      throw new Error(`No se pudo setear la fecha del lote (${normalizedDate}): ${msg}`)
    }

    // Verify date was actually set
    const dateVerify = await dateFrame.evaluate((sel: string) => {
      const input = document.querySelector(sel) as HTMLInputElement | null
        ?? document.querySelector('input[placeholder*="echa" i]') as HTMLInputElement | null
      return input?.value || ""
    }, `input[name="${DATE_INPUT_NAME}"]`)

    if (dateVerify !== normalizedDate) {
      logs.push(`[date][WARN] Fecha verificada: "${dateVerify}" (esperado: "${normalizedDate}").`)
    } else {
      logs.push(`[date] Fecha verificada correctamente: "${dateVerify}"`)
    }

    await screenshot(page, "tf-10-date-set-before-continuar", logs)

    // Step 6: Click "Continuar" now that all rows + date are filled
    logs.push("Todas las transferencias y fecha seteadas. Click en 'Continuar'...")
    const finalFrame = dateFrame
    const clickedContinuar = await clickContinuarTransferencia(page, finalFrame, logs)

    if (!clickedContinuar) {
      await screenshot(page, "tf-10-continuar-not-found", logs)
      logs.push("[WARN] No se logro hacer click efectivo en 'continuar'")
    }

    // Post-Continuar flow: wait for the confirmation page to fully render
    await page.keyboard.press("Escape").catch(() => {})
    await delay(1500)
    await screenshot(page, "tf-11-post-continuar", logs)

    // Accept T&C if present
    await acceptTermsIfPresent(page, logs)

    // Wait for the confirmation page to stabilize, then click "Preparar y autorizar"
    // The button may take several seconds to become interactive after the page loads.
    logs.push("Buscando boton 'Preparar y autorizar'...")
    let prepararClicked = false
    for (let attempt = 1; attempt <= 8; attempt++) {
      prepararClicked = await clickPrepareAndAuthorize(page, logs)
      if (prepararClicked) {
        logs.push(`[click] "Preparar y autorizar" encontrado y clickeado (intento ${attempt}).`)
        break
      }
      logs.push(`[retry] "Preparar y autorizar" no encontrado, reintentando (${attempt}/8)...`)
      await delay(2000)
    }

    if (!prepararClicked) {
      await screenshot(page, "tf-11b-preparar-not-found", logs)
      logs.push("[WARN] No se logro clickear 'Preparar y autorizar' despues de 8 intentos.")
    }
    await delay(700)

    // Wait for OTP screen
    const otpDetectTimeoutMs = Number(process.env.OTP_DETECT_TIMEOUT_MS ?? 180000)
    const otpCtx = await waitForOtpScreen(page, logs, otpDetectTimeoutMs)

    if (otpCtx) {
      await screenshot(page, "tf-12-otp-screen", logs)

      const otpEnv = manualOtp ? "" : (process.env.OTP_CODE || "").trim()

      if (manualOtp || !otpEnv) {
        shouldCloseBrowser = false
        logs.push("[otp] Esperando ingreso humano del codigo en el navegador. La ventana quedara abierta.")
      } else {
        await enterOtpCode(otpCtx, logs)
      }

      const baseTimeout = Number(process.env.SUCCESS_DETECT_TIMEOUT_MS ?? 120000)
      const successTimeoutMs = otpEnv ? baseTimeout : Math.max(baseTimeout, 1800000)
      const successResult = await waitForBankSuccess(page, logs, successTimeoutMs, { requireOtpGone: true })
      bankConfirmed = successResult.confirmed
      bankOperationId = successResult.bankOperationId

      if (manualOtp || !otpEnv) {
        shouldCloseBrowser = false
      }

      if (bankConfirmed) {
        logs.push(`[done] Confirmacion de transferencia detectada.${bankOperationId ? ` ID Banco: ${bankOperationId}` : ""}`)
        // If this is the last batch, close the browser after success
        if (options?.isLastBatch) {
          shouldCloseBrowser = true
          logs.push("[info] Ultimo lote -- el navegador se cerrara automaticamente.")
        }
      } else {
        logs.push("[done][WARN] No se detecto confirmacion de transferencia.")
      }
    } else {
      logs.push("[WARN] No se detecto pantalla de codigo (OTP).")
      if (manualOtp) shouldCloseBrowser = false
      await screenshot(page, "tf-12-otp-not-detected", logs)
    }

    await delay(2000)
    await screenshot(page, "tf-13-post-otp-wait", logs)

    if (!bankConfirmed) {
      for (const r of results) {
        if (r.success) {
          r.success = false
          r.error = "No se detecto confirmacion de transferencia en Galicia (operacion no confirmada)."
        }
      }
    }

    logs.push(bankConfirmed
      ? `Proceso finalizado exitoso: ${okCount} transferencias confirmadas para fecha ${normalizedDate}.${bankOperationId ? ` ID Banco: ${bankOperationId}` : ""}`
      : `Proceso finalizado: sin confirmacion de transferencias para fecha ${normalizedDate} (revisar en Galicia).`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logs.push(`ERROR general: ${errorMsg}`)
    for (const transfer of transfers) {
      if (!results.find((r) => r.transferId === transfer.id)) {
        results.push({ transferId: transfer.id, success: false, error: errorMsg })
      }
    }
  } finally {
    if (browser && shouldCloseBrowser) {
      await browser.close()
      _sharedBrowser = null
      logs.push("Navegador cerrado.")
    } else if (browser) {
      // Store reference so the next batch can reuse this browser
      _sharedBrowser = browser
      logs.push("Navegador queda abierto para el proximo lote.")
    }
  }

  return {
    results,
    totalSent: results.filter((r) => r.success).length,
    totalFailed: results.filter((r) => !r.success).length,
    logs,
    bankOperationId,
  }
}
