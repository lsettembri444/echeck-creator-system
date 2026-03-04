import { NextResponse } from "next/server"

/**
 * Receives raw text extracted client-side from a PDF,
 * and runs heuristics to find CUIT, amount, and provider name.
 */
export async function POST(request: Request) {
  try {
    const { text, fileName } = (await request.json()) as {
      text: string
      fileName: string
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({
        providerName: "",
        cuit: "",
        amount: 0,
        rawText: "",
        fileName: fileName || "",
        warning: "No se encontro texto en el PDF. Puede ser un PDF escaneado (imagen).",
      })
    }

    console.log("[v0] RAW first 500:", JSON.stringify(text.substring(0, 500)))

    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)

    // ==========================================================
    // CUIT EXTRACTION
    // Key insight: the issuer CUIT always appears in the RAZON SOCIAL block.
    // We extract it by finding the CUIT closest to the RAZON SOCIAL label.
    // ==========================================================
    let issuerCuit = ""
    let issuerCuitIndex = -1

    // Find positions of key labels
    const clientLabelIndex = text.search(/CLIENTE\s*:/i)
    const razonSocialIndex = text.search(/RAZ[OÓ]N\s+SOCIAL\s*:/i)

    // Collect ALL 11-digit CUIT-like numbers with their positions
    // Use a broad pattern that catches all formats
    const allCuitMatches: { cuit: string; index: number }[] = []

    // Pattern 1: Standalone "C.U.I.T." or "CUIT" label (NOT preceded by a letter, to avoid S.R.LCUIT)
    const strictCuitRegex = /(?:^|[^A-Za-z])C\.?\s?U\.?\s?I\.?\s?T\.?\s*(?:Nro\.?)?[:\s]*(\d{2}[-.]?\d{7,8}[-.]?\d)/gim
    for (const m of text.matchAll(strictCuitRegex)) {
      const clean = m[1].replace(/[-. ]/g, "")
      if (clean.length === 11) {
        allCuitMatches.push({ cuit: clean, index: m.index! })
      }
    }

    // Pattern 2: Dashed "30-71587891-3"
    if (allCuitMatches.length === 0) {
      for (const m of text.matchAll(/\b(20|23|24|27|30|33|34)-(\d{8})-(\d)\b/g)) {
        allCuitMatches.push({ cuit: `${m[1]}${m[2]}${m[3]}`, index: m.index! })
      }
    }

    // Pattern 3: Plain 11 digits with CUIT prefix
    if (allCuitMatches.length === 0) {
      for (const m of text.matchAll(/\b(20|23|24|27|30|33|34)\d{9}\b/g)) {
        allCuitMatches.push({ cuit: m[0], index: m.index! })
      }
    }

    console.log("[v0] All CUIT matches:", allCuitMatches.map(c => `${c.cuit}@${c.index}`))
    console.log("[v0] razonSocialIndex:", razonSocialIndex, "clientLabelIndex:", clientLabelIndex)

    // Deduplicate: keep first occurrence of each unique CUIT
    const seenCuits = new Set<string>()
    const uniqueCuitMatches = allCuitMatches.filter((c) => {
      if (seenCuits.has(c.cuit)) return false
      seenCuits.add(c.cuit)
      return true
    })

    console.log("[v0] Unique CUITs:", uniqueCuitMatches.map(c => `${c.cuit}@${c.index}`))

    // --- Pick issuer CUIT ---

    // Priority 1: CUIT closest to RAZON SOCIAL label (within 600 chars after it)
    if (razonSocialIndex >= 0) {
      let bestMatch: { cuit: string; index: number } | null = null
      let bestDist = Infinity
      for (const c of uniqueCuitMatches) {
        const dist = c.index - razonSocialIndex
        if (dist >= 0 && dist < 600 && dist < bestDist) {
          bestDist = dist
          bestMatch = c
        }
      }
      if (bestMatch) {
        issuerCuit = bestMatch.cuit
        issuerCuitIndex = bestMatch.index
        console.log("[v0] Priority 1 (closest to RAZON SOCIAL):", issuerCuit, "dist:", bestDist)
      }
    }

    // Priority 2: CUIT that appears BEFORE the CLIENTE label
    if (!issuerCuit && clientLabelIndex >= 0) {
      const beforeClient = uniqueCuitMatches.filter(c => c.index < clientLabelIndex)
      if (beforeClient.length > 0) {
        issuerCuit = beforeClient[0].cuit
        issuerCuitIndex = beforeClient[0].index
        console.log("[v0] Priority 2 (before CLIENTE):", issuerCuit)
      }
    }

    // Priority 3: First CUIT that is NOT immediately preceded by "CLIENTE" text
    if (!issuerCuit) {
      for (const c of uniqueCuitMatches) {
        const preceding = text.substring(Math.max(0, c.index - 150), c.index)
        if (!/CLIENTE/i.test(preceding)) {
          issuerCuit = c.cuit
          issuerCuitIndex = c.index
          console.log("[v0] Priority 3 (not near CLIENTE):", issuerCuit)
          break
        }
      }
    }

    // Priority 4: Fallback to first CUIT
    if (!issuerCuit && uniqueCuitMatches.length > 0) {
      issuerCuit = uniqueCuitMatches[0].cuit
      issuerCuitIndex = uniqueCuitMatches[0].index
      console.log("[v0] Priority 4 (fallback):", issuerCuit)
    }

    console.log("[v0] FINAL Issuer CUIT:", issuerCuit)

    // ==========================================================
    // AMOUNT EXTRACTION
    // Look for TOTAL label first, then pick the largest amount.
    // ==========================================================
    let amount = 0

    // Reusable pattern for Argentine amounts:
    // Matches both "3.000.000,00" (with dots) and "3000000,00" (without dots)
    const ARG_AMT = `\\d+(?:\\.\\d{3})*,\\d{2}`

    // Strategy 1: Find "TOTAL" label followed by amount (most reliable)
    // Must match "TOTAL$ 2.264.373,83" or "TOTAL: $ 1.790.007,45" etc.
    // Avoid matching "SUBTOTAL" or "TOTAL IVA" or "TOTAL OTROS"
    const totalLabelRegex = new RegExp(`(?:^|\\n|[^A-Z])TOTAL\\s*:?\\s*(?:\\$\\s*)?(${ARG_AMT})`, "gi")
    for (const m of text.matchAll(totalLabelRegex)) {
      const val = parseArgentineAmount(m[1])
      if (val > amount) amount = val
    }

    // Strategy 1b: "Importe Total" with amount nearby (handles line breaks between label and value)
    if (!amount) {
      const importeTotalIdx = text.search(/Importe\s+Total/i)
      if (importeTotalIdx >= 0) {
        // Look for amounts within 200 chars after "Importe Total"
        const afterTotal = text.substring(importeTotalIdx, importeTotalIdx + 200)
        const amtAfterRegex = new RegExp(ARG_AMT, "g")
        for (const m of afterTotal.matchAll(amtAfterRegex)) {
          const val = parseArgentineAmount(m[0])
          if (val > amount) amount = val
        }
        // Also look within 200 chars BEFORE "Importe Total" (some PDFs put amounts before labels)
        if (!amount) {
          const beforeTotal = text.substring(Math.max(0, importeTotalIdx - 200), importeTotalIdx)
          for (const m of beforeTotal.matchAll(amtAfterRegex)) {
            const val = parseArgentineAmount(m[0])
            if (val > amount) amount = val
          }
        }
      }
    }

    // Strategy 2: "asciende a: $ 2.264.373,83" (common footer)
    if (!amount) {
      const asciendeRegex = new RegExp(`asciende\\s+a[:\\s$]*(${ARG_AMT})`, "i")
      const asciendeMatch = text.match(asciendeRegex)
      if (asciendeMatch) {
        amount = parseArgentineAmount(asciendeMatch[1])
      }
    }

    // Strategy 3: Amounts after $ sign
    if (!amount) {
      const dollarRegex = new RegExp(`\\$\\s*(${ARG_AMT})\\b`, "g")
      for (const m of text.matchAll(dollarRegex)) {
        const val = parseArgentineAmount(m[1])
        if (val > amount) amount = val
      }
    }

    // Strategy 4: Dot-decimal format "312470.99" (OCR receipts)
    if (!amount) {
      for (const m of text.matchAll(/(\d[\d]*\.\d{2})(?:\s|$|[^.\d%])/g)) {
        const val = parseFloat(m[1])
        if (val > amount) amount = val
      }
    }

    // Strategy 5: Standalone Argentine amounts (no $ prefix) -- pick largest
    if (!amount) {
      const standaloneRegex = new RegExp(`(${ARG_AMT})\\b`, "g")
      for (const m of text.matchAll(standaloneRegex)) {
        const val = parseArgentineAmount(m[1])
        if (val > amount) amount = val
      }
    }

    console.log("[v0] Amount extracted:", amount)

    // ==========================================================
    // PROVIDER NAME EXTRACTION
    // Priority: explicit labels > company suffix > positional
    // ==========================================================
    let providerName = ""

    // Strategy 1: "RAZON SOCIAL:" label that appears BEFORE "CLIENTE:" (= issuer)
    // Or if there's no CLIENTE label at all, RAZON SOCIAL is the issuer.
    if (razonSocialIndex >= 0 && (clientLabelIndex < 0 || razonSocialIndex < clientLabelIndex)) {
      const afterLabel = text.substring(razonSocialIndex).match(/RAZ[OÓ]N\s+SOCIAL\s*:\s*(.+)/i)
      if (afterLabel) {
        const name = afterLabel[1].trim().split("\n")[0].trim()
        // Clean trailing labels like "DIRECCION:", "DOMICILIO:", etc.
        const cleaned = name.replace(/\s*(DIRECCION|DOMICILIO|CONDICION|FECHA|CUIT|C\.U\.I\.T)\b.*/i, "").trim()
        if (cleaned.length >= 3) {
          providerName = cleaned.substring(0, 120)
        }
      }
    }

    // Strategy 2: "Razón Social:" after "CLIENTE:" = client, so look for a separate issuer label
    if (!providerName && razonSocialIndex >= 0 && clientLabelIndex >= 0 && razonSocialIndex > clientLabelIndex) {
      // Razon Social belongs to client. Look for issuer name before clientLabelIndex.
      // Fall through to other strategies.
    }

    // Strategy 3: Company name with legal suffix BEFORE the issuer CUIT
    if (!providerName) {
      const nameSection = issuerCuitIndex > 0
        ? text.substring(0, issuerCuitIndex)
        : text.substring(0, Math.min(text.length, 500))
      const nameLines = nameSection.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)

      // Look for line ending with company suffix
      const companySuffixRegex = /\b(S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?S\.?|S\.?\s?C\.?\s?A\.?|SA|SRL|SAS|S\s?A|S\s?R\s?L)\s*$/i
      for (const line of nameLines) {
        if (companySuffixRegex.test(line) && line.length >= 4 && line.length <= 150) {
          if (/^\d/.test(line)) continue
          if (/^(subtotal|percep|exento|ajuste|importe|son|total|iva|fecha|condicion|responsable)/i.test(line)) continue
          providerName = line.substring(0, 120)
          break
        }
      }

      // Search within lines for inline company name
      if (!providerName) {
        const inlineRegex = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.,&'-]{2,}?\s+(?:S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?S?\.?|SA|SRL|SAS|S\s?A|S\s?R\s?L))\b/g
        for (const m of nameSection.matchAll(inlineRegex)) {
          const name = m[1].trim()
          if (name.length < 4) continue
          if (/^(Percep|Subtotal|Exento|Ajuste|Importe|Son|Total|IVA)/i.test(name)) continue
          providerName = name.substring(0, 120)
          break
        }
      }
    }

    // Strategy 4: Look backwards from issuer CUIT for any meaningful name
    if (!providerName && issuerCuitIndex > 0) {
      const beforeCuit = text.substring(0, issuerCuitIndex).split("\n").map(l => l.trim()).filter(l => l.length > 0)
      for (let i = beforeCuit.length - 1; i >= 0; i--) {
        const line = beforeCuit[i]
        if (line.length < 3) continue
        if (/^\d/.test(line)) continue
        if (/^(factura|nota|recibo|remito|original|duplicado|fecha|condicion|c\.?u\.?i\.?t|direccion|domicilio)/i.test(line)) continue
        if (/[A-ZÁÉÍÓÚÑ]{2,}/.test(line)) {
          providerName = line.substring(0, 120)
          break
        }
      }
    }

    // Strategy 5: First meaningful all-caps line in entire document
    if (!providerName) {
      for (const line of lines) {
        if (line.length < 3 || line.length > 120) continue
        if (/^\d/.test(line)) continue
        if (/^[-–($]/.test(line)) continue
        if (/^(factura|nota|recibo|remito|original|duplicado|tique)/i.test(line)) continue
        if (/^(subtotal|percep|exento|ajuste|iva|son|importe|cae|fecha|cuit|c\.u\.i\.t|condicion|responsable|total|domicilio|tel|ing|direccion|cliente|plazo)/i.test(line)) continue
        if (/^(inicio|cod\.|hora|cantidad|descripcion|precio|page\s)/i.test(line)) continue
        if (/[A-Za-záéíóúñ]{3,}/.test(line)) {
          providerName = line.substring(0, 120)
          break
        }
      }
    }

    // Clean up: remove trailing "RAZON SOCIAL:" or similar labels from provider name
    providerName = providerName
      .replace(/\s*RAZ[OÓ]N\s+SOCIAL\s*:?\s*/gi, "")
      .replace(/\s*DIRECCION\s*:.*/gi, "")
      .trim()

    console.log("[v0] Final extracted -- provider:", providerName, "cuit:", issuerCuit, "amount:", amount)

    return NextResponse.json({
      providerName: providerName || "",
      cuit: issuerCuit || "",
      amount,
      rawText: text.substring(0, 3000),
      fileName,
    })
  } catch (err) {
    console.error("[v0] PDF parse error:", err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Error al procesar: ${msg}` },
      { status: 500 }
    )
  }
}

/** Parse Argentine-format amounts: "1.234.567,89" -> 1234567.89 */
function parseArgentineAmount(raw: string): number {
  const cleaned = raw.trim()
  // "1.234.567,89" format (dots = thousands, comma = decimal)
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."))
  }
  // "1234,56" format (comma = decimal, no thousands)
  if (cleaned.includes(",")) {
    return parseFloat(cleaned.replace(",", "."))
  }
  // "1234.56" or plain number
  return parseFloat(cleaned.replace(/[^\d.]/g, "")) || 0
}
