export const runtime = "nodejs"

import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { addTransferBatch, getTransferBatches } from "@/lib/transfer-store"
import type { TransferEntry, TransferBatch } from "@/lib/transfer-types"

function toISODateParts(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, "0")
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function normalizeDateToISO(input: unknown): string {
  // Handle JS Date objects (XLSX may output Date instances)
  if (input instanceof Date && !isNaN(input.getTime())) {
    return toISODateParts(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate())
  }

  if (input == null) return ""

  if (typeof input === "number" && !isNaN(input) && input > 30000) {
    const excelDate = XLSX.SSF.parse_date_code(input)
    if (excelDate) return toISODateParts(excelDate.y, excelDate.m, excelDate.d)
  }

  const s = String(input).trim()

  if (!isNaN(Number(s)) && Number(s) > 30000) {
    const excelDate = XLSX.SSF.parse_date_code(Number(s))
    if (excelDate) return toISODateParts(excelDate.y, excelDate.m, excelDate.d)
  }

  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (m) {
    // Ambiguity guard:
    // - If the middle number is > 12, it's almost certainly MM/DD/YYYY (US-style)
    //   e.g. 2/20/2026. In that case swap.
    // - Otherwise treat as DD/MM/YYYY (AR-style)
    const a = Number(m[1])
    const b = Number(m[2])
    const yyyy = Number(m[3])
    const isUS = b > 12 && a >= 1 && a <= 12
    const dd = isUS ? b : a
    const mm = isUS ? a : b
    return toISODateParts(yyyy, mm, dd)
  }

  m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (m) {
    const yyyy = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    return toISODateParts(yyyy, mm, dd)
  }

  return s
}

export async function GET() {
  const batches = getTransferBatches()
  return NextResponse.json(batches)
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet)

    if (rawData.length === 0) {
      return NextResponse.json({ error: "La planilla esta vacia" }, { status: 400 })
    }

    const normalizeKey = (key: string) =>
      key
        .toLowerCase()
        .trim()
        .replace(/[\s_\-().]+/g, "")

    const transfers: TransferEntry[] = rawData.map((row, index) => {
      const normalized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeKey(key)] = value
      }

      // Proveedor
      const providerName = String(
        normalized["proveedor"] ??
          normalized["provider"] ??
          normalized["nombre"] ??
          normalized["name"] ??
          normalized["razonsocial"] ??
          "Desconocido"
      )

      // CUIT
      const cuitNumber = String(
        normalized["cuit"] ??
          normalized["cuitnumber"] ??
          normalized["payeecuitnumber"] ??
          ""
      )

      // CBU
      const cbu = String(
        normalized["cbu"] ??
          normalized["cbunumber"] ??
          normalized["cuentadestino"] ??
          ""
      )

      // Monto
      const amount = Number(
        normalized["monto"] ??
          normalized["amount"] ??
          normalized["importe"] ??
          normalized["chequeamount"] ??
          0
      )

      // Fecha de Pago
      const rawPaymentDate =
        normalized["fechadepago"] ??
        normalized["fechapago"] ??
        normalized["fecha"] ??
        normalized["paymentdate"] ??
        normalized["date"] ??
        new Date().toISOString().split("T")[0]
      const paymentDate = normalizeDateToISO(rawPaymentDate)

      return {
        id: `tf-${Date.now()}-${index}`,
        providerName,
        cuitNumber,
        cbu,
        amount: isNaN(amount) ? 0 : amount,
        paymentDate,
        status: "pending" as const,
      }
    })

    const batch: TransferBatch = {
      id: `tfbatch-${Date.now()}`,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      transfers,
      totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
    }

    addTransferBatch(batch)

    return NextResponse.json(batch, { status: 201 })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json(
      { error: "Error al procesar el archivo. Asegurese de que sea un .xlsx valido." },
      { status: 400 }
    )
  }
}
