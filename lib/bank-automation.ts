import puppeteer, { type Page, type Browser, type Frame } from "puppeteer-core"
import os from "os"
import path from "path"
import fs from "fs"
import type { CheckEntry } from "./types"


function logInfo(logs: string[], msg: string) {
  // Keep only high-signal messages in production
  logs.push(msg)
}
function logDebug(logs: string[], msg: string) {
  if (DEBUG_MODE) logs.push(msg)
}

export const URL_LOGIN = "https://empresas.bancogalicia.com.ar/login"
export const VIEWPORT = { width: 1400, height: 900 }
const SCREENSHOTS_DIR = path.join(process.cwd(), "debug-screenshots")

// Production defaults: no debug noise, no screenshots
const DEBUG_MODE = (process.env.ECHECK_DEBUG ?? "0") === "1"

const FAST_MODE = (process.env.ECHECK_FAST ?? "1") === "1"
const KEY_DELAY_MS = Number(process.env.ECHECK_KEY_DELAY_MS ?? (FAST_MODE ? 5 : 50))
const POST_FIELD_DELAY_MS = Number(process.env.ECHECK_POST_FIELD_DELAY_MS ?? (FAST_MODE ? 150 : 800))
const AFTER_FILLED_DELAY_MS = Number(process.env.ECHECK_AFTER_FILLED_DELAY_MS ?? (FAST_MODE ? 200 : 1500))
const AFTER_ADD_CHECK_DELAY_MS = Number(process.env.ECHECK_AFTER_ADD_CHECK_DELAY_MS ?? (FAST_MODE ? 150 : 400))
const ADD_CHECK_WAIT_TIMEOUT_MS = Number(process.env.ECHECK_ADD_CHECK_WAIT_TIMEOUT_MS ?? (FAST_MODE ? 3000 : 15000))
const ENABLE_SCREENSHOTS = DEBUG_MODE && (process.env.ECHECK_SCREENSHOTS ?? "0") === "1"

export function chromePath(): string {
  switch (os.platform()) {
    case "win32":
      return "C:/Program Files/Google/Chrome/Application/chrome.exe"
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    case "linux":
      return "/usr/bin/google-chrome"
    default:
      return "/usr/bin/google-chrome"
  }
}

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function normalizeDateToDDMMYYYY(input: string): string {
  // Accept "DD/MM/YYYY", "D/M/YYYY", "YYYY-MM-DD", "YYYY/MM/DD"
  const s = input.trim()
  // DD/MM/YYYY
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (m) {
    // Ambiguity guard (same as transfers API):
    // If the middle number is > 12, it's likely MM/DD/YYYY.
    const a = Number(m[1])
    const b = Number(m[2])
    const yyyy = m[3]
    const isUS = b > 12 && a >= 1 && a <= 12
    const dd = String(isUS ? b : a).padStart(2, "0")
    const mm = String(isUS ? a : b).padStart(2, "0")
    return `${dd}/${mm}/${yyyy}`
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (m) {
    const yyyy = m[1]
    const mm = m[2].padStart(2, "0")
    const dd = m[3].padStart(2, "0")
    return `${dd}/${mm}/${yyyy}`
  }
  return s // fallback as-is
}

async function setDateOfPayment(
  page: Page,
  formFrame: Frame,
  dateValueRaw: string,
  logs: string[]
): Promise<void> {
  const dateValue = normalizeDateToDDMMYYYY(dateValueRaw)
  logs.push(`Llenando "Fecha de pago" con: ${dateValue}`)

  // 1) Focus the input
  const focused = await formFrame.evaluate(() => {
    const input = document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null
    if (!input) return false
    input.scrollIntoView({ block: "center" })
    input.focus()
    input.click()
    return true
  })
  if (!focused) {
    logs.push('[WARN] No se encontro el campo de fecha (placeholder *="fecha")')
    return
  }

  // 2) Use native setter + events (more reliable than keyboard for React-controlled inputs)
  const setOk = await formFrame.evaluate((val: string) => {
    const input = document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null
    if (!input) return { ok: false, value: "" }
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set
    if (nativeSetter) nativeSetter.call(input, val)
    else input.value = val
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.blur()
    return { ok: true, value: input.value }
  }, dateValue)

  if (setOk.ok && setOk.value?.includes(dateValue.slice(0, 5))) {
    logDebug(logs, `[date] Fecha seteada por setter: "${setOk.value}"`)
    // Close any open datepicker popover (it can remain open and block clicks)
    await delay(150)
    await page.keyboard.press("Escape").catch(() => {})
    await delay(150)
    await formFrame
      .evaluate(() => {
        // Focus another field to force popover close
        const desc = document.querySelector('input[name="cheques_emitir_descripcion"]') as HTMLInputElement | null
        if (desc) {
          desc.focus()
          desc.click()
          return
        }
        ;(document.body as HTMLElement).click?.()
      })
      .catch(() => {})
    await delay(250)
    return
  }

  // 3) Fallback: type + Enter
  await page.keyboard.down("Control")
  await page.keyboard.press("a")
  await page.keyboard.up("Control")
  await delay(150)
  await page.keyboard.type(dateValue, { delay: 60 })
  await delay(300)
  await page.keyboard.press("Enter")
  await delay(300)
  await page.keyboard.press("Escape")
  await delay(300)

  // Extra safety: focus another field so the calendar closes
  await formFrame
    .evaluate(() => {
      const desc = document.querySelector('input[name="cheques_emitir_descripcion"]') as HTMLInputElement | null
      if (desc) {
        desc.focus()
        desc.click()
      } else {
        ;(document.body as HTMLElement).click?.()
      }
    })
    .catch(() => {})
  await delay(250)

  // 4) Verify result
  const finalVal = await formFrame.evaluate(() => {
    const input = document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null
    return input?.value || ""
  })
  logDebug(logs, `[date] Valor final en input fecha: "${finalVal}"`)
}


// Save a screenshot for debugging purposes
export async function screenshot(page: Page, name: string, logs: string[]) {
  if (!ENABLE_SCREENSHOTS) return
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
    }
    const filePath = path.join(SCREENSHOTS_DIR, `${Date.now()}-${name}.png`)
    await page.screenshot({ path: filePath, fullPage: false })
      } catch {
      }
}

// Debug helper: list all visible text on page to understand the DOM
export async function debugVisibleText(page: Page, logs: string[]) {
  if (!DEBUG_MODE) return
  const info = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("span"))
      .map((s) => s.innerText?.trim())
      .filter((t) => t && t.length < 60)
      .slice(0, 30)
    const buttons = Array.from(document.querySelectorAll("button, a"))
      .map((b) => (b as HTMLElement).innerText?.trim())
      .filter((t) => t && t.length < 60)
      .slice(0, 20)
    return { spans, buttons }
  })
  logDebug(logs, `[debug] Spans visibles: ${JSON.stringify(info.spans)}`)
  logDebug(logs, `[debug] Botones/links visibles: ${JSON.stringify(info.buttons)}`)
}

// Try to click an element by matching its text content across all frames
export async function clickByText(
  page: Page,
  textPattern: RegExp,
  exactText: string | null,
  logs: string[]
): Promise<boolean> {
  // Strategy 1: Try in main frame with exact innerText match (like original script)
  if (exactText) {
    const clicked = await page.evaluate((txt: string) => {
      const el = Array.from(document.querySelectorAll("span")).find(
        (x) => x.innerText?.trim() === txt
      )
      if (el) { el.click(); return true }
      return false
    }, exactText)
    if (clicked) {
      logDebug(logs, `[click] Encontrado por texto exacto en span: "${exactText}"`)
      return true
    }
  }

  // Strategy 2: Try regex match on broader set of elements in main frame
  const clicked2 = await page.evaluate((pattern: string) => {
    const re = new RegExp(pattern, "i")
    const selectors = "span, a, button, div, h5, h4, h3, li, p"
    const els = Array.from(document.querySelectorAll(selectors))
    for (const el of els) {
      const text = (el as HTMLElement).innerText?.trim() || ""
      if (re.test(text) && text.length < 60) {
        (el as HTMLElement).click()
        return text
      }
    }
    return null
  }, textPattern.source)
  if (clicked2) {
    logDebug(logs, `[click] Encontrado por regex en main frame: "${clicked2}"`)
    return true
  }

  // Strategy 3: Search inside all iframes
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    try {
      const clickedFrame = await frame.evaluate((pattern: string, txt: string | null) => {
        const re = new RegExp(pattern, "i")
        const selectors = "span, a, button, div, h5, h4, h3, li, p"
        const els = Array.from(document.querySelectorAll(selectors))
        for (const el of els) {
          const text = (el as HTMLElement).innerText?.trim() || ""
          // Try exact match first, then regex
          if ((txt && text === txt) || re.test(text)) {
            if (text.length < 60) {
              (el as HTMLElement).click()
              return text
            }
          }
        }
        return null
      }, textPattern.source, exactText)
      if (clickedFrame) {
        logDebug(logs, `[click] Encontrado en iframe: "${clickedFrame}"`)
        return true
      }
    } catch {
      // iframe might not be accessible
    }
  }

  logDebug(logs, `[click] NO encontrado: pattern=${textPattern.source}, exact="${exactText}"`)
  return false
}

export interface AutomationResult {
  success: boolean
  checkId: string
  error?: string
}

export interface BatchAutomationResult {
  results: AutomationResult[]
  totalSent: number
  totalFailed: number
  logs: string[]
}

/**
 * Login to Banco Galicia Empresas -- exact copy of original script logic
 */
export async function loginGalicia(page: Page, user: string, pass: string, logs: string[]) {
  logs.push("Iniciando login en Galicia Empresas...")
  await page.goto(URL_LOGIN, { waitUntil: "domcontentloaded" })
  await delay(4000)

  // Find the login iframe (same strategy as original script)
  let frame: Frame | null = null
  for (let i = 0; i < 10; i++) {
    for (const f of page.frames()) {
      const html = await f.content().catch(() => "")
      if (html.includes("usuario") || html.includes("contraseña")) {
        frame = f
        break
      }
    }
    if (frame) break
    await delay(500)
  }
  if (!frame) frame = page.mainFrame()

  const inputs = await frame.$$("input")
  const [inputUser, inputPass] = inputs
  if (!inputUser || !inputPass) throw new Error("No se detectaron campos de login.")

  await inputUser.type(user, { delay: 70 })
  await inputPass.type(pass, { delay: 70 })

  const btn =
    (await frame.$("button[type='submit']")) || (await frame.$("button"))
  if (btn) await btn.click()
  else await frame.keyboard.press("Enter")

  await page.waitForFunction(() => /cuentas/i.test(document.body.innerText), {
    timeout: 60000,
  })
  logs.push("Login exitoso.")
  await screenshot(page, "01-post-login", logs)
}

/**
 * Navigate to Cuentas > Emitir cheques
 * Uses same pattern as original script: find <span> by innerText, click, wait
 */
async function navegarEmitirCheques(page: Page, logs: string[]) {
  // Wait for dashboard to fully render (original script uses 6000-7000ms)
  logs.push("Esperando que cargue el dashboard...")
  await delay(6000)
  await debugVisibleText(page, logs)
  await screenshot(page, "02-dashboard", logs)

  // Click "Cuentas" -- exact same pattern as original "Inversiones" click
  logs.push("Buscando menu 'Cuentas'...")
  const clickedCuentas = await clickByText(page, /^Cuentas$/i, "Cuentas", logs)
  if (!clickedCuentas) {
    await screenshot(page, "03-cuentas-not-found", logs)
    throw new Error("No se encontro el menu 'Cuentas' en la pagina")
  }

  logs.push("Click en Cuentas realizado. Esperando submenu...")
  await delay(7000)
  await debugVisibleText(page, logs)
  await screenshot(page, "04-after-cuentas", logs)

  // Click "Emitir cheques"
  logs.push("Buscando 'Emitir cheques'...")
  const clickedEmitir = await clickByText(page, /emitir cheques/i, "Emitir cheques", logs)
  if (!clickedEmitir) {
    // Sometimes the link text might be slightly different, try alternatives
    const alt1 = await clickByText(page, /emitir echeq/i, null, logs)
    if (!alt1) {
      const alt2 = await clickByText(page, /emisi.n.*cheque/i, null, logs)
      if (!alt2) {
        await screenshot(page, "05-emitir-not-found", logs)
        throw new Error("No se encontro 'Emitir cheques' en el submenu de Cuentas")
      }
    }
  }

  logs.push("Click en Emitir cheques realizado. Esperando formulario...")
  await delay(7000)
  await debugVisibleText(page, logs)
  await screenshot(page, "06-formulario-cheques", logs)
  logs.push("En pantalla de emision de cheques.")
}

/**
 * Fill a field by finding a label/text and then typing into its associated input
 */
async function fillField(
  page: Page,
  labelPattern: RegExp,
  value: string,
  logs: string[]
) {
  logs.push(`Llenando campo "${labelPattern.source}" con: ${value}`)

  // Try to find the input associated with the label
  const found = await page.evaluate((pattern: string) => {
    const re = new RegExp(pattern, "i")
    // Search labels first
    const labels = Array.from(document.querySelectorAll("label"))
    for (const label of labels) {
      if (re.test(label.textContent?.trim() || "")) {
        const forAttr = label.htmlFor
        let input: HTMLInputElement | null = null
        if (forAttr) input = document.getElementById(forAttr) as HTMLInputElement
        if (!input) input = label.querySelector("input")
        if (!input) input = label.closest("div")?.querySelector("input") || null
        if (!input) input = label.parentElement?.querySelector("input") || null
        if (input) {
          input.focus()
          input.value = ""
          input.dispatchEvent(new Event("input", { bubbles: true }))
          return true
        }
      }
    }
    // Search spans/divs that act as labels
    const textEls = Array.from(document.querySelectorAll("span, div, p"))
    for (const el of textEls) {
      const text = (el as HTMLElement).innerText?.trim() || ""
      if (re.test(text) && text.length < 50) {
        const container = el.closest("div")
        const input = container?.querySelector("input")
        if (input) {
          (input as HTMLInputElement).focus();
          (input as HTMLInputElement).value = ""
          input.dispatchEvent(new Event("input", { bubbles: true }))
          return true
        }
      }
    }
    return false
  }, labelPattern.source)

  if (!found) {
    logs.push(`[WARN] No se encontro campo para "${labelPattern.source}"`)
  }

  // Type the value into the currently focused element
  await page.keyboard.type(value, { delay: 50 })
  await delay(1000)
}

/**
 * Find the iframe that contains the check emission form.
 * Returns the Frame if found, or null.
 */
async function findFormFrame(page: Page, logs: string[]): Promise<Frame | null> {
  // First check all iframes for the cheques form inputs
  for (const frame of page.frames()) {
    try {
      const hasForm = await frame.evaluate(() => {
        // Look for the known CUIT input or any input with "cheques" in the name
        const cuitInput = document.querySelector('input[name="cheques_emitir_cuit"]')
        if (cuitInput) return true
        const inputs = Array.from(document.querySelectorAll("input"))
        return inputs.some((i) => i.name.toLowerCase().includes("cheque"))
      })
      if (hasForm) {
        logDebug(logs, `[iframe] Formulario de cheques encontrado en frame: ${frame.url()}`)
        return frame
      }
    } catch {
      // iframe not accessible
    }
  }

  // Fallback: check if the form is in the main frame after all
  const mainHasForm = await page.evaluate(() => {
    return !!document.querySelector('input[name="cheques_emitir_cuit"]')
  })
  if (mainHasForm) {
    logDebug(logs, "[iframe] Formulario encontrado en main frame")
    return page.mainFrame()
  }

  logs.push("[WARN] No se encontro el formulario de cheques en ningun frame")
  return null
}

/**
 * Fill an input inside a specific frame by CSS selector.
 */
async function fillInFrame(
  frame: Frame,
  selector: string,
  value: string,
  fieldName: string,
  logs: string[]
) {
  logs.push(`Llenando "${fieldName}" (${selector}) con: ${value}`)

  const found = await frame.evaluate((sel: string) => {
    const input = document.querySelector(sel) as HTMLInputElement
    if (!input) return false
    input.focus()
    input.click()
    // Use native setter to clear + trigger events
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set
    if (nativeSetter) {
      nativeSetter.call(input, "")
    } else {
      input.value = ""
    }
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, selector)

  if (!found) {
    logs.push(`[WARN] No se encontro input "${fieldName}" con selector "${selector}"`)
    return
  }

  // Type the value character by character into the focused element
  await frame.page()!.keyboard.type(value, { delay: KEY_DELAY_MS })
  await delay(POST_FIELD_DELAY_MS)
}

/**
 * Fill a single check's data into the bank form (iframe-aware)
 */
async function llenarCheque(page: Page, formFrame: Frame, check: CheckEntry, index: number, logs: string[]) {
  logs.push(`--- Cheque ${index + 1}: ${check.payeeName} (CUIT: ${check.cuitNumber}) ---`)

  // Dump all input names/ids in the form frame for debugging (first check only)
  if (index === 0) {
    const inputInfo = await formFrame.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((i) => ({
        name: i.name,
        id: i.id,
        type: i.type,
        placeholder: i.placeholder,
        autocomplete: i.autocomplete,
        labeltext: i.getAttribute("labeltext"),
      }))
    })
    logDebug(logs, `[debug] Inputs en el formulario (iframe): ${JSON.stringify(inputInfo)}`)
  }

  // a) CUIT in input[name="cheques_emitir_cuit"]
  await fillInFrame(formFrame, 'input[name="cheques_emitir_cuit"]', check.cuitNumber, "CUIT / Numero", logs)

  // b) Email -- find by name containing "mail" or labeltext "Mail"
  const emailSel = await formFrame.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"))
    for (const inp of inputs) {
      const n = (inp.name || "").toLowerCase()
      const lt = (inp.getAttribute("labeltext") || "").toLowerCase()
      const ac = (inp.autocomplete || "").toLowerCase()
      if (n.includes("mail") || lt.includes("mail") || ac.includes("mail")) {
        if (inp.name) return `input[name="${inp.name}"]`
        if (inp.id) return `input#${inp.id}`
      }
    }
    return null
  })
  if (emailSel) {
    await fillInFrame(formFrame, emailSel, check.email, "Email", logs)
  } else {
    logs.push("[WARN] No se encontro campo de email por selector, intentando por labeltext...")
    await fillInFrame(formFrame, 'input[labeltext*="Mail" i]', check.email, "Email (fallback)", logs)
  }

  // c) Monto -- find by name containing "monto" or "importe"
  const montoStr = check.amount.toString().replace(".", ",")
  const montoSel = await formFrame.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"))
    for (const inp of inputs) {
      const n = (inp.name || "").toLowerCase()
      const lt = (inp.getAttribute("labeltext") || "").toLowerCase()
      if (n.includes("monto") || n.includes("importe") || lt.includes("monto")) {
        if (inp.name) return `input[name="${inp.name}"]`
        if (inp.id) return `input#${inp.id}`
      }
    }
    return null
  })
  if (montoSel) {
    await fillInFrame(formFrame, montoSel, montoStr, "Monto", logs)
  } else {
    logs.push("[WARN] No se encontro campo de monto por selector, intentando por labeltext...")
    await fillInFrame(formFrame, 'input[labeltext*="Monto" i]', montoStr, "Monto (fallback)", logs)
  }

  // d) Fecha de pago
  await setDateOfPayment(page, formFrame, check.paymentDate, logs)

  // Safety: ensure no popovers (datepicker) are covering the action buttons
  await page.keyboard.press("Escape").catch(() => {})
  await delay(150)
  await formFrame
    .evaluate(() => {
      const desc = document.querySelector('input[name="cheques_emitir_descripcion"]') as HTMLInputElement | null
      if (desc) {
        desc.focus()
        desc.click()
      } else {
        ;(document.body as HTMLElement).click?.()
      }
    })
    .catch(() => {})
  await delay(250)

  await delay(AFTER_FILLED_DELAY_MS)
  await screenshot(page, `07-cheque-${index + 1}-filled`, logs)

  // Click "Agregar cheque" (en Galicia suele ser button[data-tour="add_check"]).
  logs.push("Click en 'Agregar cheque'...")
  const clickedAgregar = await clickAgregarCheque(page, formFrame, logs)
  if (!clickedAgregar) {
    await screenshot(page, `08-agregar-not-found-${index + 1}`, logs)
    throw new Error(`No se encontro/clickó boton 'Agregar cheque' para cheque ${index + 1}`)
  }

  // Wait for the form to react: either CUIT input cleared or cheque row list increased
  try {
    const before = await formFrame.evaluate(() => {
      const cuit = document.querySelector('input[name="cheques_emitir_cuit"]') as HTMLInputElement | null
      const rows = document.querySelectorAll("table tbody tr").length
      return { cuit: cuit?.value || "", rows }
    })
    await delay(AFTER_ADD_CHECK_DELAY_MS)
    await formFrame.waitForFunction(
      (prev: any) => {
        const cuit = (document.querySelector('input[name="cheques_emitir_cuit"]') as HTMLInputElement | null)?.value || ""
        const rows = document.querySelectorAll("table tbody tr").length
        return (prev.cuit && cuit === "") || rows > prev.rows
      },
      { timeout: ADD_CHECK_WAIT_TIMEOUT_MS },
      before
    ).catch(() => {})
  } catch { /* ignore */ }


  await delay(2500)
  await screenshot(page, `09-cheque-${index + 1}-added`, logs)
  logs.push(`Cheque ${index + 1} para ${check.payeeName} agregado.`)
}

/**
 * Click robusto del botón "Agregar cheque".
 * Problema típico: el texto está en un <div>/<span> interno y hacer click ahí no dispara el handler.
 * Solución: priorizar el selector real del botón y usar ElementHandle.click().
 */
async function clickAgregarCheque(page: Page, formFrame: Frame, logs: string[]): Promise<boolean> {
  const selectorsInFrame = [
    'button[data-tour="add_check"]',
    'button[aria-label="Agregar cheque"]',
    'button[aria-label*="Agregar" i]',
  ]

  // 1) Intento directo dentro del iframe
  for (const sel of selectorsInFrame) {
    try {
      const handle = await formFrame.$(sel)
      if (!handle) continue
      await formFrame.evaluate((el: any) => el.scrollIntoView({ block: 'center', inline: 'center' }), handle)
      await delay(150)
      await handle.click({ delay: 50 }).catch(() => {})
      logDebug(logs, `[click] Agregar cheque via iframe selector: ${sel}`)
      return true
    } catch {
      // continue
    }
  }

  // 2) Por texto, pero click en el BOTÓN más cercano (no en el DIV/SPAN)
  try {
    const clicked = await formFrame.evaluate(() => {
      const re = /agregar\s+cheque/i
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div')) as HTMLElement[]
      for (const n of nodes) {
        const txt = (n.innerText || '').trim()
        if (!re.test(txt) || txt.length > 60) continue
        const btn = n.closest('button, [role="button"], a') as HTMLElement | null
        const target = btn || n
        ;(target as any).scrollIntoView?.({ block: 'center', inline: 'center' })
        ;(target as any).click?.()
        return true
      }
      return false
    })
    if (clicked) {
      logs.push('[click] Agregar cheque via texto (iframe)')
      return true
    }
  } catch {
    // ignore
  }

  // 3) Último recurso: click por texto en la página principal
  const clickedMain = await clickByText(page, /agregar cheque/i, null, logs)
  if (clickedMain) logs.push('[click] Agregar cheque via texto (page)')
  return clickedMain
}

/**
 * Attempt to accept Terms & Conditions on the post-"Continuar" screens.
 * Galicia frequently renders a checkbox with text like "Acepto los términos y condiciones".
 */
export async function acceptTermsIfPresent(page: Page, logs: string[]) {
  const termsRe = /t[eé]rminos|condiciones|acepto|declaro|he le[ií]do/i

  const tryInContext = async (ctx: Page | Frame, where: string) => {
    try {
      const clicked = await (ctx as any).evaluate((reSrc) => {
        const re = new RegExp(reSrc, "i")
        const root = document

        const scrollAndClick = (el: Element | null | undefined) => {
          if (!el) return false
          try {
            ;(el as any).scrollIntoView?.({ block: 'center', inline: 'center' })
            ;(el as any).click?.()
            return true
          } catch {
            return false
          }
        }

        // 0) UIs modernas: role=checkbox / aria-label
        const ariaCheckboxes = Array.from(root.querySelectorAll('[role="checkbox"], [aria-checked]')) as HTMLElement[]
        for (const el of ariaCheckboxes) {
          const txt = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim()
          if (!re.test(txt)) continue
          const ariaChecked = el.getAttribute('aria-checked')
          if (ariaChecked === 'true') return true
          if (scrollAndClick(el)) return true
        }

        // 1) Caso clásico: label + checkbox
        const labels = Array.from(root.querySelectorAll('label')) as HTMLLabelElement[]
        for (const label of labels) {
          const txt = (label.textContent || '').trim()
          if (!re.test(txt)) continue

          // A) label[for] -> input#id
          const forId = label.getAttribute('for')
          if (forId) {
            const input = root.getElementById(forId) as HTMLInputElement | null
            if (input && input.type === 'checkbox') {
              if (!input.checked) input.click()
              return true
            }
          }

          // B) checkbox dentro del label
          const inside = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null
          if (inside) {
            if (!inside.checked) inside.click()
            return true
          }

          // C) checkbox cerca del label
          const parent = label.parentElement
          if (parent) {
            const near = parent.querySelector('input[type="checkbox"]') as HTMLInputElement | null
            if (near) {
              if (!near.checked) near.click()
              return true
            }
          }

          // D) a veces el checkbox es invisible: se clickéa el label/contenedor
          if (scrollAndClick(label)) return true
        }

        // 2) Fallback: buscar cualquier nodo con texto (acepto/términos) y clickear el contenedor más cercano
        const nodes = Array.from(root.querySelectorAll('button, [role="button"], a, div, span, p')) as HTMLElement[]
        for (const n of nodes) {
          const t = (n.textContent || '').trim()
          if (!re.test(t) || t.length > 200) continue
          const host = (n.closest('[role="checkbox"], label, [role="button"], button, a, div') as HTMLElement | null) || n
          // si hay un checkbox real dentro, preferirlo
          const cb = host.querySelector('input[type="checkbox"]') as HTMLInputElement | null
          if (cb) {
            if (!cb.checked) cb.click()
            return true
          }
          if (scrollAndClick(host)) return true
        }

        return false
      }, termsRe.source)

      if (clicked) {
        logs.push(`[terms] T&C aceptados (${where})`)
        // Give React time to enable buttons
        await delay(500)

        // Some flows require an additional confirmation click after checking the box.
        // We try to click the first reasonable confirm/continue button in the same context.
        const clickedButton = await (ctx as any)
          .evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('button, [role="button"], a')) as HTMLElement[]
            const isGood = (txt: string) => {
              const s = (txt || "").trim().toLowerCase()
              return (
                s === "aceptar" ||
                s === "acepto" ||
                s.includes("acept") ||
                s.includes("confirm") ||
                s.includes("continuar") ||
                s.includes("firm")
              )
            }
            const el = nodes.find((n) => isGood(n.textContent || ""))
            if (!el) return false
            ;(el as any).click?.()
            return true
          })
          .catch(() => false)

        if (clickedButton) logs.push(`[terms] Click extra en botón de confirmación (${where})`)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Try current page first
  if (await tryInContext(page, "page")) {
    await delay(600)
    return true
  }

  // Try in each frame
  for (const f of page.frames()) {
    if (!f.url()) continue
    if (await tryInContext(f, `frame:${f.url()}`)) {
      await delay(600)
      return true
    }
  }

  logs.push("[terms] No se encontraron T&C para aceptar (ok si el flujo no los pide).")
  return false
}

/**
 * Wait until an OTP / security code screen appears (human must type).
 */
export type OtpContext = { where: "page" | "frame"; ctx: Page | Frame; url?: string }


export async function clickPrepareAndAuthorize(page: Page, logs: string[]): Promise<boolean> {
  const re = /preparar\s+y\s+autorizar/i

  const tryInContext = async (ctx: Page | Frame, where: string) => {
    try {
      const clicked = await (ctx as any).evaluate((reSrc) => {
        const re = new RegExp(reSrc, "i")
        // Prefer explicit aria-label or button text
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
        for (const b of buttons) {
          const t = ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim()
          if (re.test(t)) {
            b.scrollIntoView({ block: 'center', inline: 'center' })
            b.click()
            return true
          }
        }
        // Fallback: span.button-wrap containing text -> closest button
        const spans = Array.from(document.querySelectorAll('span')) as HTMLSpanElement[]
        for (const s of spans) {
          const t = (s.textContent || '').trim()
          if (!re.test(t)) continue
          const btn = s.closest('button') as HTMLButtonElement | null
          if (btn) {
            btn.scrollIntoView({ block: 'center', inline: 'center' })
            btn.click()
            return true
          }
        }
        return false
      }, re.source)

      if (clicked) {
        logDebug(logs, `[click] "Preparar y autorizar" clickeado (${where}).`)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Try page first
  if (await tryInContext(page, "page")) return true
  // Then frames (UI sometimes lives in iframes/modals)
  for (const f of page.frames()) {
    if (await tryInContext(f, `frame: ${f.url()}`)) return true
  }
  logs.push('[warn] No se encontró el botón "Preparar y autorizar".')
  return false
}

export async function waitForOtpScreen(page: Page, logs: string[], timeoutMs: number): Promise<OtpContext | null> {
  const start = Date.now()
  const hasOtpInContext = async (ctx: Page | Frame) => {
    try {
      return await (ctx as any).evaluate(() => {
        const text = (document.body?.innerText || "").toLowerCase()
        const hasText =
  text.includes("código") || text.includes("codigo") || text.includes("seguridad") || text.includes("token") ||
  text.includes("autoriz") || text.includes("firma")

// Common OTP inputs
const sels = [
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[type="password"]',
]
const hasInput = sels.some((s) => document.querySelector(s))

// Heuristic: many OTP screens have a single numeric input with maxlength 4-8
const heuristic = Array.from(document.querySelectorAll('input')).some((i: any) => {
  const el = i as HTMLInputElement
  const ml = Number(el.getAttribute('maxlength') || 0)
  const im = (el.getAttribute('inputmode') || '').toLowerCase()
  return (ml >= 4 && ml <= 8) && (im === 'numeric' || el.type === 'tel' || el.type === 'password')
})

return (hasInput || heuristic) && (hasText || heuristic)
      })
    } catch {
      return false
    }
  }

  while (Date.now() - start < timeoutMs) {
    if (await hasOtpInContext(page)) {
      logs.push("[otp] Pantalla de codigo detectada (page).")
      return { where: "page", ctx: page }
    }
    for (const f of page.frames()) {
      if (await hasOtpInContext(f)) {
        logs.push(`[otp] Pantalla de codigo detectada (frame: ${f.url()}).`)
        return { where: "frame", ctx: f, url: f.url() }
      }
    }
    await delay(500)
  }

  logs.push("[otp] Timeout esperando pantalla de codigo.")
  return null
}

/**
 * Enter the OTP code when the bank asks for it.
 * - If OTP_CODE env var exists, it's used.
 * - Otherwise we prompt in the console (so you don't need to touch the browser).
 */

/**
 * OTP handling:
 * - If OTP_CODE env var exists, it will be typed automatically.
 * - Otherwise we assume a HUMAN will type it in the browser, and we just wait for success.
 */
export async function enterOtpCode(otpCtx: OtpContext, logs: string[]) {
  const otp = (process.env.OTP_CODE || "").trim()
  if (!otp) {
    logs.push("[otp] Esperando ingreso humano del código en el navegador (no se solicita por consola).")
    return
  }

  const ctx = otpCtx.ctx as any
  logs.push("[otp] OTP_CODE provisto por entorno, escribiendo código automáticamente...")

  const filled = await ctx.evaluate((code: string) => {
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
    // Prefer one-time-code field
    const preferred = inputs.find(i => i.getAttribute('autocomplete') === 'one-time-code') ||
      inputs.find(i => i.inputMode === 'numeric') ||
      inputs.find(i => i.type === 'tel') ||
      inputs.find(i => i.type === 'password') ||
      inputs.find(i => i.type === 'text')

    if (!preferred) return false
    preferred.focus()

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    if (nativeSetter) nativeSetter.call(preferred, code)
    else preferred.value = code
    preferred.dispatchEvent(new Event("input", { bubbles: true }))
    preferred.dispatchEvent(new Event("change", { bubbles: true }))
    preferred.blur()
    return true
  }, otp)

  if (!filled) {
    logs.push("[otp] No pude encontrar input de OTP para escribirlo.")
    return
  }

  // Try clicking a confirm/authorize button if present
  await delay(400)
  await (otpCtx.ctx as any).evaluate(() => {
    const re = /confirmar|autorizar|firmar|continuar|enviar/i
    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const b = btns.find(x => re.test((x.innerText || '').toLowerCase()) && !(x as any).disabled && x.getAttribute('aria-disabled') !== 'true')
    b?.click?.()
  }).catch(() => {})
}


/**
 * Consideramos el flujo "terminado" cuando Galicia muestra una confirmación de éxito
 * (comprobante / operación realizada / cheques emitidos).
 */
export async function waitForBankSuccess(
  page: Page,
  logs: string[],
  timeoutMs: number,
  opts?: { requireOtpGone?: boolean }
): Promise<boolean> {
  const start = Date.now()
  const hasSuccess = async (ctx: Page | Frame) => {
    try {
      return await (ctx as any).evaluate((requireOtpGone: boolean) => {
        const t = (document.body?.innerText || "").toLowerCase()
        const success = (
          t.includes("operación realizada") ||
          t.includes("operacion realizada") ||
          t.includes("emitidos correctamente") ||
          t.includes("cheques emitidos") ||
          t.includes("comprobante") ||
          t.includes("número de operación") ||
          t.includes("numero de operacion")
        )

        if (!success) return false
        if (!requireOtpGone) return true

        // Avoid false positives when the OTP challenge is still on screen.
        const otpWords = t.includes("código") || t.includes("codigo") || t.includes("token")
        const otpInput = !!document.querySelector(
          'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="tel"], input[type="password"], input[type="number"]'
        )
        return !(otpWords || otpInput)
      }, Boolean(opts?.requireOtpGone))
    } catch {
      return false
    }
  }

  while (Date.now() - start < timeoutMs) {
    if (await hasSuccess(page)) return true
    for (const f of page.frames()) {
      if (await hasSuccess(f)) return true
    }
    await delay(750)
  }
  return false
}

/**
 * Main automation: logs in, navigates, fills all checks, clicks continuar
 */
export async function ejecutarEmisionCheques(
  checks: CheckEntry[],
  options?: {
    /** Run Puppeteer in headless mode (defaults to false). */
    headless?: boolean
    /**
     * If true, the script will wait for a human to type the OTP in the bank UI and will NOT auto-close the browser.
     * Defaults to true (safer).
     */
    manualOtp?: boolean
  }
): Promise<BatchAutomationResult> {
  const user = process.env.GALICIA_USER
  const pass = process.env.GALICIA_PASS

  if (!user || !pass) {
    return {
      results: checks.map((c) => ({
        checkId: c.id,
        success: false,
        error: "Faltan GALICIA_USER o GALICIA_PASS en variables de entorno",
      })),
      totalSent: 0,
      totalFailed: checks.length,
      logs: ["ERROR: Faltan credenciales GALICIA_USER / GALICIA_PASS en .env"],
    }
  }

  const logs: string[] = []
  const results: AutomationResult[] = []
  // Safer default: keep the window open so a human can type the OTP.
  // To enable fully automatic OTP, call ejecutarEmisionCheques(..., { manualOtp: false }).
  const manualOtp = options?.manualOtp ?? true
  let browser: Browser | null = null
  let shouldCloseBrowser = true

  try {
    logs.push("Abriendo navegador...")
    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromePath(),
      defaultViewport: VIEWPORT,
      userDataDir: "./.chrome-galicia-cheques",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
    const page = await browser.newPage()

    // Step 1: Login
    await loginGalicia(page, user, pass, logs)

    // Step 2: Navigate to Cuentas > Emitir cheques
    await navegarEmitirCheques(page, logs)

    // Step 3: Find the iframe containing the check form
    const formFrame = await findFormFrame(page, logs)
    if (!formFrame) {
      // Dump all frame URLs for debugging
      const frameUrls = page.frames().map((f) => f.url())
      logDebug(logs, `[debug] Frames disponibles: ${JSON.stringify(frameUrls)}`)
      throw new Error("No se encontro el formulario de cheques en ningun iframe")
    }

    // Step 4: Fill each check inside the form iframe
    for (let i = 0; i < checks.length; i++) {
      const check = checks[i]
      try {
        const currentFrame = (await findFormFrame(page, logs)) || formFrame
        await llenarCheque(page, currentFrame, check, i, logs)
        results.push({ checkId: check.id, success: true })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logs.push(`ERROR en cheque ${check.payeeName}: ${errorMsg}`)
        results.push({ checkId: check.id, success: false, error: errorMsg })
        await screenshot(page, `error-cheque-${i + 1}`, logs)
      }
    }

    // Step 5: Click "continuar" after all checks are added
    const okCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length
    if (okCount === 0) {
      logs.push("[WARN] No se agrego ningun cheque; no se hara click en 'continuar'.")
      await screenshot(page, "10-no-cheques-agregados", logs)
      return {
        results,
        totalSent: okCount,
        totalFailed: failCount,
        logs,
      }
    }
    if (failCount > 0) {
      logs.push("[WARN] Hubo errores cargando cheques; no se continuara para evitar emitir incompleto.")
      await screenshot(page, "10-errors-before-continuar", logs)
      return {
        results,
        totalSent: okCount,
        totalFailed: failCount,
        logs,
      }
    }
    const finalFrame = (await findFormFrame(page, logs)) || formFrame
    logs.push("Todos los cheques agregados. Click en 'continuar'...")
    // Some UI popovers (datepicker) can cover the button; close them
    await page.keyboard.press("Escape").catch(() => {})
    await delay(200)

    const startUrl = page.url()
    const startFrameUrl = finalFrame?.url?.() || ""

    let clickedContinuar = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) logs.push(`[retry] Reintentando click en 'continuar' (intento ${attempt}/3)...`)

      // Try inside the form frame first
      if (finalFrame) {
        try {
          clickedContinuar = await finalFrame.evaluate(() => {
            // Prefer real buttons first
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
            // Fallback: any button containing continuar
            for (const b of btns) {
              const text = (b as HTMLElement).innerText?.trim() || ""
              const disabled = (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true"
              if (/continuar/i.test(text) && !disabled) {
                b.scrollIntoView({ block: "center" })
                ;(b as HTMLElement).click()
                return true
              }
            }
            // Fallback: clickable elements with text
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
        } catch {
          /* ignore */
        }
      }

      if (!clickedContinuar) {
        // Fallback to main page
        clickedContinuar = await clickByText(page, /continuar/i, null, logs)
      }

      if (!clickedContinuar) {
        await delay(400)
        continue
      }

      logDebug(logs, "[click] Intento de 'continuar' ejecutado")

      // Wait for any sign of progress: url change, frame url change, or new heading/text
      const progressed = await page
        .waitForFunction(
          (u, fu) => {
            const urlChanged = location.href !== u
            const hasConfirmText = /confirmar|resumen|firmar|validar/i.test(document.body?.innerText || "")
            // iframe url cannot be read directly here; rely on text or top url change
            return urlChanged || hasConfirmText
          },
          { timeout: 12000 },
          startUrl,
          startFrameUrl
        )
        .then(() => true)
        .catch(() => false)

      if (progressed) break

      // If no progress, maybe a popover is still open. Close + retry.
      await page.keyboard.press("Escape").catch(() => {})
      await delay(350)
      clickedContinuar = false
    }

    if (!clickedContinuar) {
      await screenshot(page, "10-continuar-not-found", logs)
      logs.push("[WARN] No se logro hacer click efectivo en 'continuar'")
    }

    let bankConfirmed = false

    // Post-Continuar flow: accept T&C then pause for human OTP
    // Close popovers just in case
    await page.keyboard.press("Escape").catch(() => {})
    await delay(600)

    // Try accepting Terms & Conditions if present
    await acceptTermsIfPresent(page, logs)

    // Click "Preparar y autorizar" if present (it usually appears after accepting terms)
    await clickPrepareAndAuthorize(page, logs)
    await delay(700)

    // Wait for OTP screen and pause for a human to type the security code
    const otpDetectTimeoutMs = Number(process.env.OTP_DETECT_TIMEOUT_MS ?? 180000) // default 3 minutes
    const otpCtx = await waitForOtpScreen(page, logs, otpDetectTimeoutMs)
    
	if (otpCtx) {
	  await screenshot(page, "12-otp-screen", logs)

	  // In manual OTP mode we ignore OTP_CODE and we never auto-close the browser.
	  const otpEnv = manualOtp ? "" : (process.env.OTP_CODE || "").trim()

	  if (manualOtp || !otpEnv) {
	    shouldCloseBrowser = false
	    logs.push("[otp] Esperando ingreso humano del código en el navegador. La ventana quedará abierta (no se cerrará automáticamente).")
	  } else {
	    await enterOtpCode(otpCtx, logs)
	  }

	  // Esperar confirmación de éxito (más tiempo por defecto cuando el OTP es manual)
	  const baseTimeout = Number(process.env.SUCCESS_DETECT_TIMEOUT_MS ?? 120000)
	  const successTimeoutMs = otpEnv ? baseTimeout : Math.max(baseTimeout, 1800000) // min 30 min for manual OTP
	  bankConfirmed = await waitForBankSuccess(page, logs, successTimeoutMs, { requireOtpGone: true })

	  // Manual OTP: never auto-close
	  if (manualOtp || !otpEnv) {
	    shouldCloseBrowser = false
	  }

	  logs.push(bankConfirmed ? "[done] Confirmación de emisión detectada." : "[done][WARN] No se detectó confirmación de emisión.")
	} else {
	  logs.push("[WARN] No se detectó pantalla de código (OTP); se deja evidencia.")
	  // If OTP is manual we keep the window open anyway.
	  if (manualOtp) shouldCloseBrowser = false
	  await screenshot(page, "12-otp-not-detected", logs)
	}

    await delay(2000)
    await screenshot(page, "13-post-otp-wait", logs)
    if (!bankConfirmed) {
      // No marcamos "sent" si Galicia no confirmó la operación.
      for (const r of results) {
        if (r.success) {
          r.success = false
          r.error = "No se detectó confirmación de emisión en Galicia (operación no confirmada)."
        }
      }
    }

    logs.push(bankConfirmed ? "Proceso finalizado: emisión confirmada por Galicia." : "Proceso finalizado: sin confirmación de emisión (revisar en Galicia).")
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logs.push(`ERROR general: ${errorMsg}`)
    for (const check of checks) {
      if (!results.find((r) => r.checkId === check.id)) {
        results.push({ checkId: check.id, success: false, error: errorMsg })
      }
    }
  } finally {
    if (browser && shouldCloseBrowser) {
      await browser.close()
      logs.push("Navegador cerrado.")
    } else if (browser) {
      logs.push("Navegador queda abierto para OTP/verificacion manual.")
    }
  }

  return {
    results,
    totalSent: results.filter((r) => r.success).length,
    totalFailed: results.filter((r) => !r.success).length,
    logs,
  }
}
