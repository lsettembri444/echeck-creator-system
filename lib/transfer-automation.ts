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

function logDebug(logs: string[], msg: string) {
  if (DEBUG_MODE) logs.push(msg)
}

function normalizeDateToISOYYYYMMDD(input: string): string {
  const s = (input ?? "").toString().trim()
  // DD/MM/YYYY or D/M/YYYY
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (m) {
    const dd = m[1].padStart(2, "0")
    const mm = m[2].padStart(2, "0")
    const yyyy = m[3]
    return `${yyyy}-${mm}-${dd}`
  }
  // YYYY-MM-DD or YYYY/MM/DD
  m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (m) {
    const yyyy = m[1]
    const mm = m[2].padStart(2, "0")
    const dd = m[3].padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }
  return s
}


function normalizeMoney(raw: string): { dot: string; comma: string } {
  // Accepts formats like "1.234,56" | "1234,56" | "1234.56" | "1,234.56" | "1234"
  let s = (raw ?? "").toString().trim()
  s = s.replace(/\s/g, "").replace(/[^\d.,-]/g, "")

  const lastComma = s.lastIndexOf(",")
  const lastDot = s.lastIndexOf(".")

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIsComma = lastComma > lastDot
    if (decimalIsComma) {
      // "1.234,56" -> "1234.56"
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      // "1,234.56" -> "1234.56"
      s = s.replace(/,/g, "")
    }
  } else if (lastComma !== -1) {
    // "1234,56" -> "1234.56"
    s = s.replace(",", ".")
  } else {
    // "1234.56" or "1234"
  }

  const dot = s
  const comma = s.replace(".", ",")
  return { dot, comma }
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
        const text = (document.body?.innerText || "").toLowerCase()
        const hasTransferText = text.includes("cuenta destino") || text.includes("transferencia")
        const inputs = Array.from(document.querySelectorAll("input"))
        const hasTransferInput = inputs.some((i) => {
          const n = (i.name || "").toLowerCase()
          const lt = (i.getAttribute("labeltext") || "").toLowerCase()
          return n.includes("destino") || n.includes("cbu") || n.includes("monto") ||
            lt.includes("destino") || lt.includes("cbu") || lt.includes("monto")
        })
        return hasTransferText || hasTransferInput
      })
      if (hasForm) {
        logDebug(logs, `[iframe] Formulario de transferencia encontrado en frame: ${frame.url()}`)
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
    logDebug(logs, "[iframe] Formulario de transferencia encontrado en main frame")
    return page.mainFrame()
  }

  logs.push("[WARN] No se encontro el formulario de transferencia en ningun frame")
  return null
}

/**
 * Fill an input inside a specific frame by finding labels/text.
 */

/**
 * Robustly set a text value in an input by locating a visible label/text and then the nearest input.
 * Works even when inputs lack stable name/id and avoids brittle nth-of-type selectors.
 */
async function setInputByLabelText(
  page: Page,
  frame: Frame,
  labelRe: RegExp,
  value: string,
  fieldName: string,
  logs: string[]
): Promise<boolean> {
  logs.push(`Set "${fieldName}" por label: ${value}`)
  const ok = await frame.evaluate((pattern: string, val: string) => {
    const re = new RegExp(pattern, "i")

    // Prefer scoping to the "Transferencia/s" card if present (reduces risk of hitting global search).
    const roots: HTMLElement[] = []
    const cardCandidates = Array.from(document.querySelectorAll("section, div")) as HTMLElement[]
    for (const el of cardCandidates) {
      const t = (el.innerText || "").toLowerCase()
      if (t.includes("transferencia/s") || t.includes("transferencias")) {
        roots.push(el)
        break
      }
    }
    if (roots.length === 0) roots.push(document.body as HTMLElement)

    function findInRoot(root: HTMLElement): HTMLInputElement | null {
      // 1) Real <label>
      for (const label of Array.from(root.querySelectorAll("label"))) {
        const txt = (label.textContent || "").trim()
        if (re.test(txt)) {
          const forAttr = (label as HTMLLabelElement).htmlFor
          let inp: HTMLInputElement | null = null
          if (forAttr) inp = document.getElementById(forAttr) as HTMLInputElement | null
          if (!inp) inp = label.querySelector("input")
          if (!inp) inp = label.closest("div")?.querySelector("input") as HTMLInputElement | null
          if (!inp) inp = label.parentElement?.querySelector("input") as HTMLInputElement | null
          if (inp) return inp
        }
      }

      // 2) Text nodes (span/div/p) that look like a field label
      const textEls = Array.from(root.querySelectorAll("span, div, p")) as HTMLElement[]
      for (const el of textEls) {
        const txt = (el.innerText || "").trim()
        if (!txt || txt.length > 40) continue
        if (!re.test(txt)) continue

        const container =
          (el.closest("div") as HTMLElement | null) ||
          (el.parentElement as HTMLElement | null)

        if (!container) continue

        // Try: same container input, or next sibling containers
        let inp =
          (container.querySelector("input") as HTMLInputElement | null) ||
          (container.parentElement?.querySelector("input") as HTMLInputElement | null)

        if (!inp) {
          const sib = container.nextElementSibling as HTMLElement | null
          inp = sib?.querySelector("input") as HTMLInputElement | null
        }

        if (inp) return inp
      }

      return null
    }

    let input: HTMLInputElement | null = null
    for (const root of roots) {
      input = findInRoot(root)
      if (input) break
    }
    if (!input) return false

    input.scrollIntoView({ block: "center" })
    input.focus()
    input.click()

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    if (nativeSetter) nativeSetter.call(input, val)
    else input.value = val

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.blur()
    return true
  }, labelRe.source, value)

  // Some Galicia fields commit only on Tab
  if (ok) {
    await delay(120)
    await page.keyboard.press("Tab").catch(() => {})
    await delay(180)
  } else {
    logs.push(`[WARN] No se encontro input para "${fieldName}" por label`)
  }

  return ok
}

async function fillTransferField(
  frame: Frame,
  labelPattern: RegExp,
  value: string,
  fieldName: string,
  logs: string[]
) {
  logs.push(`Llenando "${fieldName}" con: ${value}`)

  const found = await frame.evaluate((pattern: string) => {
    const re = new RegExp(pattern, "i")

    // Search labels
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
          input.click()
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set
          if (nativeSetter) nativeSetter.call(input, "")
          else input.value = ""
          input.dispatchEvent(new Event("input", { bubbles: true }))
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return true
        }
      }
    }

    // Search spans/divs
    const textEls = Array.from(document.querySelectorAll("span, div, p"))
    for (const el of textEls) {
      const text = (el as HTMLElement).innerText?.trim() || ""
      if (re.test(text) && text.length < 50) {
        const container = el.closest("div")
        const input = container?.querySelector("input")
        if (input) {
          (input as HTMLInputElement).focus();
          (input as HTMLInputElement).click()
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set
          if (nativeSetter) nativeSetter.call(input as HTMLInputElement, "")
          else (input as HTMLInputElement).value = ""
          input.dispatchEvent(new Event("input", { bubbles: true }))
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return true
        }
      }
    }

    // Search by input name/labeltext directly
    const inputs = Array.from(document.querySelectorAll("input"))
    for (const inp of inputs) {
      const n = (inp.name || "").toLowerCase()
      const lt = (inp.getAttribute("labeltext") || "").toLowerCase()
      const ph = (inp.placeholder || "").toLowerCase()
      if (re.test(n) || re.test(lt) || re.test(ph)) {
        inp.focus()
        inp.click()
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set
        if (nativeSetter) nativeSetter.call(inp, "")
        else inp.value = ""
        inp.dispatchEvent(new Event("input", { bubbles: true }))
        inp.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
    }

    return false
  }, labelPattern.source)

  if (!found) {
    logs.push(`[WARN] No se encontro campo para "${fieldName}" (${labelPattern.source})`)
    return
  }

  await frame.page()!.keyboard.type(value, { delay: KEY_DELAY_MS })
  await delay(POST_FIELD_DELAY_MS)
}

/**
 * Set the "Fecha de envio" field for a transfer.
 * Uses the EXACT same pattern as setDateOfPayment for checks:
 * find by placeholder*="fecha" first, then fallback to label search.
 */
async function setTransferDate(
  page: Page,
  formFrame: Frame,
  dateValueRaw: string,
  logs: string[]
): Promise<void> {
  const ddmmyyyy = normalizeDateToDDMMYYYY(dateValueRaw)
  const iso = normalizeDateToISOYYYYMMDD(dateValueRaw)

  // 1) Focus the input (same approach as cheques, with fallbacks)
  const focused = await formFrame.evaluate(() => {
    const byPh = document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null
    if (byPh) {
      byPh.scrollIntoView({ block: "center" })
      byPh.focus()
      byPh.click()
      return { found: true as const, via: "placeholder", type: byPh.type || "" }
    }

    const byLt = document.querySelector('input[labeltext*="fecha" i]') as HTMLInputElement | null
    if (byLt) {
      byLt.scrollIntoView({ block: "center" })
      byLt.focus()
      byLt.click()
      return { found: true as const, via: "labeltext", type: byLt.type || "" }
    }

    const byName = document.querySelector('input[name*="fecha" i]') as HTMLInputElement | null
    if (byName) {
      byName.scrollIntoView({ block: "center" })
      byName.focus()
      byName.click()
      return { found: true as const, via: "name", type: byName.type || "" }
    }

    const byType = document.querySelector('input[type="date"]') as HTMLInputElement | null
    if (byType) {
      byType.scrollIntoView({ block: "center" })
      byType.focus()
      byType.click()
      return { found: true as const, via: "type=date", type: byType.type || "" }
    }

    // Heuristic label search (last resort)
    const labels = Array.from(document.querySelectorAll("label, span, div"))
    for (const el of labels) {
      const text = ((el as HTMLElement).innerText || (el as HTMLElement).textContent || "")
        .trim()
        .toLowerCase()
      if (text.includes("fecha") && text.length < 80) {
        const container = el.closest("div") || el.parentElement
        const input = container?.querySelector("input") as HTMLInputElement | null
        if (input) {
          input.scrollIntoView({ block: "center" })
          input.focus()
          input.click()
          return { found: true as const, via: "label-search", type: input.type || "" }
        }
      }
    }

    return { found: false as const, via: "", type: "" }
  })

  if (!focused.found) {
    logs.push('[WARN] No se encontro el campo de fecha de envio en ningun selector')
    const allInputs = await formFrame.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map((i) => ({
        name: i.name,
        id: i.id,
        type: i.type,
        placeholder: i.placeholder,
        labeltext: i.getAttribute("labeltext"),
        value: i.value,
      }))
    })
    logs.push(`[debug] Inputs encontrados: ${JSON.stringify(allInputs)}`)
    return
  }

  const valueToSet = (focused.type || "").toLowerCase() === "date" ? iso : ddmmyyyy
  logs.push(`Llenando "Fecha de envio" con: ${valueToSet} (type=${focused.type || "text"})`)
  logDebug(logs, `[date] Campo de fecha encontrado via: ${focused.via}`)

  // 2) Native setter + events (same as cheques)
  const setOk = await formFrame.evaluate((val: string) => {
    const active = document.activeElement as HTMLInputElement | null
    const input =
      active && active.tagName === "INPUT"
        ? active
        : ((document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null) ||
            (document.querySelector('input[labeltext*="fecha" i]') as HTMLInputElement | null) ||
            (document.querySelector('input[name*="fecha" i]') as HTMLInputElement | null) ||
            (document.querySelector('input[type="date"]') as HTMLInputElement | null))

    if (!input) return { ok: false, value: "" }

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    if (nativeSetter) nativeSetter.call(input, val)
    else input.value = val

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.blur()

    return { ok: true, value: input.value }
  }, valueToSet)

  logDebug(logs, `[date] Setter ok=${setOk.ok}, value="${setOk.value}"`)

  // 3) If setter didn't stick, fallback to typing + Enter (kept from cheques)
  const expectedSep = (focused.type || "").toLowerCase() === "date" ? "-" : "/"
  const looksOk = setOk.ok && (setOk.value?.includes(expectedSep) || setOk.value?.includes(valueToSet.slice(0, 4)))

  if (!looksOk) {
    await delay(150)
    await page.keyboard.down("Control")
    await page.keyboard.press("a")
    await page.keyboard.up("Control")
    await delay(150)
    await page.keyboard.type(valueToSet, { delay: 60 })
    await delay(250)
    await page.keyboard.press("Enter").catch(() => {})
    await delay(250)
  }

  // 4) Close any open datepicker popover (Galicia often renders it OUTSIDE the iframe)
  await delay(150)
  await page.keyboard.press("Escape").catch(() => {})
  await delay(120)
  await page.keyboard.press("Escape").catch(() => {})

  // Click on the top document (not the iframe) to ensure the popover closes
  await page
    .evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      ;(document.body as HTMLElement).click?.()
    })
    .catch(() => {})

  // Extra safety: click on a neutral area (top-left) in case an overlay blocks body click
  try {
    await page.mouse.click(5, 5)
  } catch {}

  // Move focus away from the date input so the calendar doesn't reopen
  await delay(150)
  await page.keyboard.press("Tab").catch(() => {})
  await delay(250)

  // 5) Verify final
  const finalVal = await formFrame.evaluate(() => {
    const input =
      (document.querySelector('input[placeholder*="fecha" i]') as HTMLInputElement | null) ||
      (document.querySelector('input[labeltext*="fecha" i]') as HTMLInputElement | null) ||
      (document.querySelector('input[name*="fecha" i]') as HTMLInputElement | null) ||
      (document.querySelector('input[type="date"]') as HTMLInputElement | null)
    return input?.value || ""
  })
  logs.push(`[date] Valor final de fecha: "${finalVal}"`)

  // Close datepicker/popover reliably (it may be outside the iframe)
  await delay(120)
  await page.keyboard.press("Escape").catch(() => {})
  await delay(80)
  await page.keyboard.press("Escape").catch(() => {})
  await delay(120)
  await page.evaluate(() => (document.body as any)?.click?.())
  await delay(120)
  await page.mouse.click(5, 5).catch(() => {})
  await delay(120)
  await page.keyboard.press("Tab").catch(() => {})
  await delay(160)
}



async function setTransferAmount(
  page: Page,
  formFrame: Frame,
  amountRaw: string,
  logs: string[]
): Promise<void> {
  const { dot, comma } = normalizeMoney(amountRaw)

  // Helper: pick the "Monto" input inside the Transferencia/s card (avoid the global search box)
  const pickInfo = await formFrame.evaluate(() => {
    function textMatches(el: Element | null, needle: string) {
      return !!el && (el.textContent || "").trim().toLowerCase() === needle.toLowerCase()
    }

    // 1) Scope to the Transferencia/s section/card if possible
    const headers = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span"))
    const transfersTitleEl = headers.find(el => (el.textContent || "").trim().toLowerCase() === "transferencia/s")
    let scope: Element | Document = document
    if (transfersTitleEl) {
      scope = transfersTitleEl.closest("section,div,main,article") || document
    }

    // 2) Find the column label "Monto" inside scope (best anchor)
    const labelCandidates = Array.from((scope as any).querySelectorAll?.("label,div,span,th") || []) as Element[]
    const montoLabel = labelCandidates.find(el => (el.textContent || "").trim().toLowerCase() === "monto") || null
    const labelRect = montoLabel ? (montoLabel as HTMLElement).getBoundingClientRect() : null

    // 3) Collect inputs within scope (exclude hidden/disabled)
    const inputs = Array.from((scope as any).querySelectorAll?.("input") || []) as HTMLInputElement[]
    const visibles = inputs
      .map((el, idx) => ({ el, idx }))
      .filter(({ el }) => {
        const r = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const visible = r.width > 20 && r.height > 18 && style.visibility !== "hidden" && style.display !== "none"
        return visible && !el.disabled && el.type !== "hidden"
      })

    // 4) If we have labelRect, choose the input that's aligned under it
    let bestIdx: number | null = null
    if (labelRect) {
      const labelCx = labelRect.left + labelRect.width / 2
      let bestScore = Number.POSITIVE_INFINITY
      for (const v of visibles) {
        const r = v.el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        // Prefer inputs below the label, and roughly aligned horizontally
        const dy = Math.max(0, r.top - labelRect.bottom)
        const dx = Math.abs(cx - labelCx)
        const score = dy * 1.0 + dx * 0.5
        if (dy >= 0 && dx < 250 && score < bestScore) {
          bestScore = score
          bestIdx = v.idx
        }
      }
    }

    // 5) Fallbacks: look for semantic attributes within scope
    if (bestIdx === null) {
      const semantic = visibles.find(v => {
        const el = v.el
        const s = [
          el.name,
          el.id,
          el.getAttribute("aria-label"),
          el.getAttribute("placeholder"),
          el.getAttribute("inputmode"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return s.includes("monto") || s.includes("importe") || s.includes("amount")
      })
      if (semantic) bestIdx = semantic.idx
    }

    return {
      found: bestIdx !== null,
      bestIdx,
      inScopeCount: inputs.length,
      visibleCount: visibles.length,
      hasMontoLabel: !!montoLabel,
      scopeTag: (scope as any).tagName || "document",
    }
  })

  logs.push(
    `[monto] pick: found=${pickInfo.found} idx=${pickInfo.bestIdx} visibles=${pickInfo.visibleCount} hasLabel=${pickInfo.hasMontoLabel} scope=${pickInfo.scopeTag}`
  )

  if (!pickInfo.found || pickInfo.bestIdx == null) {
    logs.push('[WARN] No se encontro el campo "Monto" dentro de Transferencia/s (evitando el buscador global)')
    return
  }

  // Focus chosen input
  await formFrame.evaluate((idx: number) => {
    const input = Array.from(document.querySelectorAll("input"))[idx] as HTMLInputElement | undefined
    if (!input) return
    input.scrollIntoView({ block: "center" })
    input.focus()
    input.click()
    input.select?.()
  }, pickInfo.bestIdx)

  // Try dot-decimal then comma-decimal
  for (const val of [dot, comma]) {
    logs.push(`[monto] Intentando setear: "${val}"`)

    const res = await formFrame.evaluate(
      (payload: { idx: number; val: string }) => {
        const input = Array.from(document.querySelectorAll("input"))[payload.idx] as HTMLInputElement | undefined
        if (!input) return { ok: false, value: "" }

        input.focus()
        input.select?.()

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
        if (nativeSetter) nativeSetter.call(input, payload.val)
        else input.value = payload.val

        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
        input.blur()

        return { ok: true, value: input.value }
      },
      { idx: pickInfo.bestIdx, val }
    )

    logs.push(`[monto] value despues setter: "${res.value}"`)

    // Commit (mask/formatter often needs a keystroke + blur/tab)
    await delay(120)
    await page.keyboard.press("Tab").catch(() => {})
    await delay(150)

    const finalVal = await formFrame.evaluate((idx: number) => {
      const input = Array.from(document.querySelectorAll("input"))[idx] as HTMLInputElement | undefined
      return input?.value || ""
    }, pickInfo.bestIdx)

    logs.push(`[monto] valor final: "${finalVal}"`)

    if (/\d/.test(finalVal)) return
  }

  logs.push('[WARN] No logro setear "Monto" (posible mascara muy estricta o selector dentro de scope incorrecto)')
}



/**
 * Fill an input inside a specific frame by CSS selector (same approach as fillInFrame for checks).
 */
async function fillTransferInFrame(
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
    input.scrollIntoView({ block: "center" })
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
    return false
  }

  // Type the value character by character into the focused element
  await frame.page()!.keyboard.type(value, { delay: KEY_DELAY_MS })
  await delay(POST_FIELD_DELAY_MS)
  return true
}

/**
 * Find a CSS selector for an input by trying multiple strategies.
 */
async function findInputSelector(
  frame: Frame,
  patterns: { name?: RegExp; labeltext?: RegExp; placeholder?: RegExp },
  logs: string[]
): Promise<string | null> {
  return frame.evaluate((pats: { name?: string; labeltext?: string; placeholder?: string }) => {
    const inputs = Array.from(document.querySelectorAll("input"))
    for (const inp of inputs) {
      const n = (inp.name || "").toLowerCase()
      const lt = (inp.getAttribute("labeltext") || "").toLowerCase()
      const ph = (inp.placeholder || "").toLowerCase()

      let match = false
      if (pats.name && new RegExp(pats.name, "i").test(n)) match = true
      if (pats.labeltext && new RegExp(pats.labeltext, "i").test(lt)) match = true
      if (pats.placeholder && new RegExp(pats.placeholder, "i").test(ph)) match = true

      if (match) {
        if (inp.name) return `input[name="${inp.name}"]`
        if (inp.id) return `input#${inp.id}`
        // Fallback: use index
        const idx = inputs.indexOf(inp)
        return `input:nth-of-type(${idx + 1})`
      }
    }
    return null
  }, {
    name: patterns.name?.source,
    labeltext: patterns.labeltext?.source,
    placeholder: patterns.placeholder?.source,
  })
}

/**
 * Fill a single transfer's data into the bank form
 */
async function llenarTransferencia(
  page: Page,
  formFrame: Frame,
  transfer: TransferEntry,
  index: number,
  logs: string[]
) {
  logs.push(`--- Transferencia ${index + 1}: ${transfer.providerName} (CUIT: ${transfer.cuitNumber}, CBU: ${transfer.cbu}) ---`)

  // Dump ALL input info for debugging (always, to help diagnose issues)
  const inputInfo = await formFrame.evaluate(() => {
    return Array.from(document.querySelectorAll("input")).map((i, idx) => ({
      idx,
      name: i.name,
      id: i.id,
      type: i.type,
      placeholder: i.placeholder,
      labeltext: i.getAttribute("labeltext"),
      value: i.value,
      ariaLabel: i.getAttribute("aria-label"),
    }))
  })
  logs.push(`[debug] Inputs en formulario (${inputInfo.length}): ${JSON.stringify(inputInfo)}`)

  // a) Cuenta destino (CBU / Alias)
// IMPORTANT: use label-based targeting to avoid typing into the global search box.
const okDestino = await setInputByLabelText(page, formFrame, /cuenta\s*destino/i, transfer.cbu, "Cuenta destino / CBU", logs)
if (!okDestino) {
  // secondary attempt by keywords
  await setInputByLabelText(page, formFrame, /destino|cbu|alias/i, transfer.cbu, "Cuenta destino / CBU", logs)
}

// Wait for CBU to resolve (bank validates and may auto-fill CUIT/name)
await delay(2000)


  // b) Monto - completar con native setter + eventos (igual que cheques; soporta máscara)
  await setTransferAmount(page, formFrame, transfer.amount.toString(), logs)

  // c) Fecha de envio = Fecha de Pago del Excel (do LAST to avoid datepicker covering other fields) de envio = Fecha de Pago del Excel (do LAST to avoid datepicker covering other fields)
  await setTransferDate(page, formFrame, transfer.paymentDate, logs)

  await delay(AFTER_FILLED_DELAY_MS)
  await screenshot(page, `tf-07-transfer-${index + 1}-filled`, logs)
  logs.push(`Transferencia ${index + 1} para ${transfer.providerName} completada.`)
}

/**
 * Click "Agregar otra transferencia" button
 */
async function clickAgregarOtraTransferencia(page: Page, formFrame: Frame, logs: string[]): Promise<boolean> {
  // Try inside iframe first
  try {
    const clicked = await formFrame.evaluate(() => {
      const re = /agregar\s+(otra\s+)?transferencia/i
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div')) as HTMLElement[]
      for (const n of nodes) {
        const txt = (n.innerText || '').trim()
        if (!re.test(txt) || txt.length > 80) continue
        const btn = n.closest('button, [role="button"], a') as HTMLElement | null
        const target = btn || n
        ;(target as any).scrollIntoView?.({ block: 'center', inline: 'center' })
        ;(target as any).click?.()
        return true
      }
      return false
    })
    if (clicked) {
      logs.push('[click] Agregar otra transferencia (iframe)')
      return true
    }
  } catch { /* ignore */ }

  // Fallback: main page
  const clickedMain = await clickByText(page, /agregar\s+(otra\s+)?transferencia/i, null, logs)
  if (clickedMain) logs.push('[click] Agregar otra transferencia (page)')
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

    logDebug(logs, "[click] Intento de 'continuar' ejecutado")

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
 * Main automation: login, navigate to transfers, fill all transfers, continue, authorize
 */
export async function ejecutarTransferencias(
  transfers: TransferEntry[],
  options?: {
    headless?: boolean
    manualOtp?: boolean
  }
): Promise<TransferBatchAutomationResult> {
  const user = process.env.GALICIA_USER
  const pass = process.env.GALICIA_PASS

  if (!user || !pass) {
    return {
      results: transfers.map((t) => ({
        transferId: t.id,
        success: false,
        error: "Faltan GALICIA_USER o GALICIA_PASS en variables de entorno",
      })),
      totalSent: 0,
      totalFailed: transfers.length,
      logs: ["ERROR: Faltan credenciales GALICIA_USER / GALICIA_PASS en .env"],
    }
  }

  const logs: string[] = []
  const results: TransferAutomationResult[] = []
  const manualOtp = options?.manualOtp ?? true
  let browser: Browser | null = null
  let shouldCloseBrowser = true

  try {
    logs.push("Abriendo navegador...")
    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromePath(),
      defaultViewport: VIEWPORT,
      userDataDir: "./.chrome-galicia-transferencias",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })
    const page = await browser.newPage()

    // Step 1: Login
    await loginGalicia(page, user, pass, logs)

    // Step 2: Navigate to Transferencias > Nueva transferencia
    await navegarNuevaTransferencia(page, logs)

    // Step 3: Find the form frame
    const formFrame = await findTransferFormFrame(page, logs)
    if (!formFrame) {
      const frameUrls = page.frames().map((f) => f.url())
      logDebug(logs, `[debug] Frames disponibles: ${JSON.stringify(frameUrls)}`)
      throw new Error("No se encontro el formulario de transferencia en ningun iframe")
    }

    // Step 4: Fill each transfer
    for (let i = 0; i < transfers.length; i++) {
      const transfer = transfers[i]
      try {
        const currentFrame = (await findTransferFormFrame(page, logs)) || formFrame
        await llenarTransferencia(page, currentFrame, transfer, i, logs)

        if (i < transfers.length - 1) {
          // More transfers to add: click "Agregar otra transferencia"
          logs.push("Click en 'Agregar otra transferencia'...")
          const clickedAdd = await clickAgregarOtraTransferencia(page, currentFrame, logs)
          if (!clickedAdd) {
            await screenshot(page, `tf-08-agregar-not-found-${i + 1}`, logs)
            throw new Error(`No se encontro boton 'Agregar otra transferencia' para transferencia ${i + 1}`)
          }
          await delay(2500)
          await screenshot(page, `tf-09-transfer-${i + 1}-added`, logs)
        }

        results.push({ transferId: transfer.id, success: true })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logs.push(`ERROR en transferencia ${transfer.providerName}: ${errorMsg}`)
        results.push({ transferId: transfer.id, success: false, error: errorMsg })
        await screenshot(page, `tf-error-transfer-${i + 1}`, logs)
      }
    }

    // Step 5: Click "Continuar" after all transfers
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

    logs.push("Todas las transferencias agregadas. Click en 'Continuar'...")
    const finalFrame = (await findTransferFormFrame(page, logs)) || formFrame
    const clickedContinuar = await clickContinuarTransferencia(page, finalFrame, logs)

    if (!clickedContinuar) {
      await screenshot(page, "tf-10-continuar-not-found", logs)
      logs.push("[WARN] No se logro hacer click efectivo en 'continuar'")
    }

    let bankConfirmed = false

    // Post-Continuar flow
    await page.keyboard.press("Escape").catch(() => {})
    await delay(600)

    // Accept T&C if present
    await acceptTermsIfPresent(page, logs)

    // Click "Preparar y autorizar"
    logs.push("Click en 'Preparar y autorizar'...")
    await clickPrepareAndAuthorize(page, logs)
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
      bankConfirmed = await waitForBankSuccess(page, logs, successTimeoutMs, { requireOtpGone: true })

      if (manualOtp || !otpEnv) {
        shouldCloseBrowser = false
      }

      logs.push(bankConfirmed ? "[done] Confirmacion de transferencia detectada." : "[done][WARN] No se detecto confirmacion de transferencia.")
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
      ? "Proceso finalizado: transferencias confirmadas por Galicia."
      : "Proceso finalizado: sin confirmacion de transferencias (revisar en Galicia).")
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
