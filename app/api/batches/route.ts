export const runtime = "nodejs"

import { NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { addBatch, getBatches } from "@/lib/store"
import type { CheckEntry, UploadedBatch } from "@/lib/types"

function toISODateParts(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, "0")
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function normalizeDateToISO(input: unknown): string {
  if (input == null) return ""

  // Excel serial date numbers
  if (typeof input === "number" && !isNaN(input) && input > 30000) {
    const excelDate = XLSX.SSF.parse_date_code(input)
    if (excelDate) return toISODateParts(excelDate.y, excelDate.m, excelDate.d)
  }

  const s = String(input).trim()

  // Some sheets provide the serial as a string
  if (!isNaN(Number(s)) && Number(s) > 30000) {
    const excelDate = XLSX.SSF.parse_date_code(Number(s))
    if (excelDate) return toISODateParts(excelDate.y, excelDate.m, excelDate.d)
  }

  // DD/MM/YYYY or D/M/YYYY (also allow - or .)
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
  if (m) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    const yyyy = Number(m[3])
    return toISODateParts(yyyy, mm, dd)
  }

  // YYYY-MM-DD or YYYY/MM/DD
  m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/)
  if (m) {
    const yyyy = Number(m[1])
    const mm = Number(m[2])
    const dd = Number(m[3])
    return toISODateParts(yyyy, mm, dd)
  }

  // Fall back to the raw string (better than guessing wrong)
  return s
}

export async function GET() {
  const batches = getBatches()
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
      return NextResponse.json({ error: "Spreadsheet is empty" }, { status: 400 })
    }

    // Normalize column names (case-insensitive, trim whitespace, remove special chars)
    const normalizeKey = (key: string) =>
      key
        .toLowerCase()
        .trim()
        .replace(/[\s_\-().]+/g, "")

    const checks: CheckEntry[] = rawData.map((row, index) => {
      const normalized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(row)) {
        normalized[normalizeKey(key)] = value
      }

      // Map: "Payee Name" -> payeename / name / payee
      const payeeName = String(
        normalized["payeename"] ??
          normalized["payee"] ??
          normalized["name"] ??
          normalized["nombre"] ??
          "Desconocido"
      )

      // Map: "Payee Cuit Number" -> payeecuitnumber / cuit / cuitnumber / numero
      const cuitNumber = String(
        normalized["payeecuitnumber"] ??
          normalized["cuitnumber"] ??
          normalized["cuit"] ??
          normalized["numero"] ??
          ""
      )

      // Map: "Cheque Amount" -> chequeamount / amount / monto
      const amount = Number(
        normalized["chequeamount"] ??
          normalized["amount"] ??
          normalized["monto"] ??
          normalized["importe"] ??
          0
      )

      // Map: "Payment Date" -> paymentdate / date / fechadepago / fecha
      // Store as ISO (YYYY-MM-DD) so the History page can parse it reliably.
      const rawPaymentDate =
        normalized["paymentdate"] ??
        normalized["date"] ??
        normalized["fechadepago"] ??
        normalized["fecha"] ??
        new Date().toISOString().split("T")[0]
      const paymentDate = normalizeDateToISO(rawPaymentDate)

      // Map: "email address" -> emailaddress / email / mail / correo
      const email = String(
        normalized["emailaddress"] ??
          normalized["emailaddrees"] ??
          normalized["email"] ??
          normalized["mail"] ??
          normalized["correo"] ??
          ""
      )

      return {
        id: `chk-${Date.now()}-${index}`,
        payeeName,
        cuitNumber,
        amount: isNaN(amount) ? 0 : amount,
        paymentDate,
        email,
        status: "pending" as const,
      }
    })

    const batch: UploadedBatch = {
      id: `batch-${Date.now()}`,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      checks,
      totalAmount: checks.reduce((sum, c) => sum + c.amount, 0),
    }

    addBatch(batch)

    return NextResponse.json(batch, { status: 201 })
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json(
      { error: "Failed to parse the uploaded file. Please ensure it is a valid .xlsx file." },
      { status: 400 }
    )
  }
}
