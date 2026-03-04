import { NextResponse } from "next/server"
import { addBatch } from "@/lib/store"
import { addTransferBatch } from "@/lib/transfer-store"
import type { UploadedBatch, CheckEntry } from "@/lib/types"
import type { TransferBatch, TransferEntry } from "@/lib/transfer-types"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      type,
      providerName,
      cuit,
      amount,
      date,
      cbu,
      email,
      fileName,
    } = body as {
      type: "cheque" | "transferencia"
      providerName: string
      cuit: string
      amount: number
      date: string
      cbu?: string
      email?: string
      fileName?: string
    }

    if (!providerName || !cuit || !amount || !date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: nombre, CUIT, monto y fecha." },
        { status: 400 }
      )
    }

    const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    if (type === "cheque") {
      const checkEntry: CheckEntry = {
        id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        payeeName: providerName,
        cuitNumber: cuit,
        amount,
        paymentDate: date,
        email: email || "",
        status: "pending",
      }

      const batch: UploadedBatch = {
        id,
        fileName: fileName || `Factura-${providerName}.pdf`,
        uploadedAt: now,
        checks: [checkEntry],
        totalAmount: amount,
      }

      addBatch(batch)

      return NextResponse.json({
        success: true,
        type: "cheque",
        batchId: id,
        message: `Cheque creado para ${providerName} por $${amount.toLocaleString("es-AR")}`,
      })
    } else if (type === "transferencia") {
      if (!cbu) {
        return NextResponse.json(
          { error: "Se requiere un CBU/Alias para transferencias." },
          { status: 400 }
        )
      }

      const transferEntry: TransferEntry = {
        id: `tf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        providerName,
        cuitNumber: cuit,
        cbu,
        amount,
        paymentDate: date,
        status: "pending",
      }

      const batch: TransferBatch = {
        id,
        fileName: fileName || `Factura-${providerName}.pdf`,
        uploadedAt: now,
        transfers: [transferEntry],
        totalAmount: amount,
      }

      addTransferBatch(batch)

      return NextResponse.json({
        success: true,
        type: "transferencia",
        batchId: id,
        message: `Transferencia creada para ${providerName} por $${amount.toLocaleString("es-AR")}`,
      })
    }

    return NextResponse.json(
      { error: "Tipo invalido. Use 'cheque' o 'transferencia'." },
      { status: 400 }
    )
  } catch (err) {
    console.error("[v0] Invoice create error:", err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Error al crear operacion: ${msg}` },
      { status: 500 }
    )
  }
}
