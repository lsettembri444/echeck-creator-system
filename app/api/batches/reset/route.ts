export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { clearAllBatches } from "@/lib/store"

export async function POST() {
  try {
    clearAllBatches()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: "No se pudo limpiar el historial" }, { status: 500 })
  }
}
