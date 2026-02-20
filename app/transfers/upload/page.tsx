"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import type { UploadedTransferBatch } from "@/lib/types"

export default function TransfersUploadPage() {
  const router = useRouter()
  const [batch, setBatch] = useState<UploadedTransferBatch | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const onFile = async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/transfers", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Error al subir Excel")
      setBatch(data)
    } catch (e: any) {
      setError(e.message || "Error")
    } finally {
      setLoading(false)
    }
  }

  
const sendBatch = async () => {
  if (!batch) return
  setSending(true)
  setMessage(null)
  setError(null)
  try {
    const res = await fetch(`/api/transfers/${batch.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || "Error al enviar transferencias")
    setMessage(data?.message || "Proceso iniciado. Completá el token en el banco.")
    // Ir al panel para ver estados
    router.push("/transfers")
  } catch (e: any) {
    setError(e.message || "Error")
  } finally {
    setSending(false)
  }
}

return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" onClick={() => router.push("/transfers")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <h2 className="text-xl font-semibold">Subir Transferencias</h2>
        </div>

        <div className="rounded-xl border p-6">
          <div className="text-sm text-muted-foreground mb-3">
            Excel con columnas: Proveedor, CUIT, CBU, Monto, Fecha de Pago
          </div>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
            }}
          />

          {loading ? <div className="mt-3 text-sm">Procesando...</div> : null}
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
{message ? <div className="mt-3 text-sm">{message}</div> : null}

          {batch ? (
            <div className="mt-6 text-sm">
              <div className="font-medium">{batch.fileName}</div>
              <div className="text-muted-foreground">
                {batch.transfers.length} transferencias ·{" "}
                {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
                  batch.totalAmount
                )}
              </div>
              <div className="mt-4 flex gap-2 flex-wrap">
  <Button onClick={sendBatch} disabled={sending}>
    {sending ? "Ejecutando..." : "Ejecutar ahora"}
  </Button>
  <Button variant="outline" onClick={() => router.push("/transfers")}>
    Ir al panel
  </Button>
</div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
