export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { deleteBatch, getBatch } from "@/lib/store"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params
  const batch = getBatch(batchId)

  if (!batch) {
    return NextResponse.json({ error: "Lote no encontrado" }, { status: 404 })
  }

  deleteBatch(batchId)
  return NextResponse.json({ success: true, message: `Lote "${batch.fileName}" eliminado.` })
}
