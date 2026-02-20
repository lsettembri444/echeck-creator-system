export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { clearAllTransferBatches } from "@/lib/transfer-store"

export async function POST() {
  try {
    clearAllTransferBatches()
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo limpiar el historial" }, { status: 500 })
  }
}
