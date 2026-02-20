"use client"

import { useCallback, useState } from "react"
import { Upload, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { UploadedBatch } from "@/lib/types"

interface UploadZoneProps {
  onUploadComplete: (batch: UploadedBatch) => void
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
        setError("Por favor suba un archivo Excel (.xlsx o .xls)")
        return
      }

      setIsUploading(true)
      setError(null)

      try {
        const formData = new FormData()
        formData.append("file", file)

        const response = await fetch("/api/batches", {
          method: "POST",
          body: formData,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || "Error al subir el archivo")
        }

        const batch: UploadedBatch = await response.json()
        onUploadComplete(batch)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al subir el archivo")
      } finally {
        setIsUploading(false)
      }
    },
    [onUploadComplete]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFile(file)
    },
    [processFile]
  )

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-all",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50",
          isUploading && "pointer-events-none opacity-60"
        )}
      >
        {isUploading ? (
          <>
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <p className="mt-4 text-sm font-medium text-foreground">Procesando planilla...</p>
          </>
        ) : (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              {isDragging ? (
                <FileSpreadsheet className="h-7 w-7 text-primary" />
              ) : (
                <Upload className="h-7 w-7 text-primary" />
              )}
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              {isDragging ? "Suelte su planilla aqui" : "Arrastre y suelte su archivo Excel"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">o haga click para seleccionar (.xlsx, .xls)</p>
            <label className="mt-4 cursor-pointer">
              <span className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Elegir Archivo
              </span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="sr-only"
                aria-label="Subir planilla Excel"
              />
            </label>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="rounded-lg bg-muted/50 px-4 py-3">
        <p className="text-xs font-medium text-foreground">Columnas esperadas en su planilla:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Payee Name", "Payee Cuit Number", "Cheque Amount", "Payment Date", "email address"].map((col) => (
            <span
              key={col}
              className="inline-flex rounded-md bg-primary/10 px-2.5 py-1 text-xs font-mono font-medium text-primary"
            >
              {col}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          Los nombres de columna son flexibles (no distinguen mayusculas/minusculas). Tambien se aceptan variaciones como &quot;CUIT&quot;, &quot;Monto&quot;, &quot;Fecha&quot;, etc.
        </p>
      </div>
    </div>
  )
}
