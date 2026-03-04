"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { cn } from "@/lib/utils"
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRightLeft,
  FileSpreadsheet,
  CalendarIcon,
  ChevronRight,
} from "lucide-react"

interface ParsedInvoice {
  providerName: string
  cuit: string
  amount: number
  rawText: string
  fileName: string
}

type OperationType = "cheque" | "transferencia" | null

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)

export default function InvoicesPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null)

  // Editable fields
  const [providerName, setProviderName] = useState("")
  const [cuit, setCuit] = useState("")
  const [amount, setAmount] = useState("")
  const [operationType, setOperationType] = useState<OperationType>(null)
  const [date, setDate] = useState("")
  const [cbu, setCbu] = useState("")
  const [email, setEmail] = useState("")

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{
    success: boolean
    message: string
    type?: string
    batchId?: string
  } | null>(null)

  const [showRawText, setShowRawText] = useState(false)
  const [parseStatus, setParseStatus] = useState("")

  // Load pdf.js v2 from CDN (once)
  const loadPdfJs = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (win.pdfjsLib) return win.pdfjsLib

    const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105"
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script")
      s.src = `${PDFJS_CDN}/pdf.min.js`
      s.onload = () => resolve()
      s.onerror = () => reject(new Error("No se pudo cargar pdf.js"))
      document.head.appendChild(s)
    })

    const pdfjsLib = win.pdfjsLib
    if (!pdfjsLib) throw new Error("pdf.js no se cargo")

    // Load worker as Blob URL to avoid cross-origin issues
    try {
      const res = await fetch(`${PDFJS_CDN}/pdf.worker.min.js`)
      const text = await res.text()
      const blob = new Blob([text], { type: "application/javascript" })
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ""
    }

    return pdfjsLib
  }, [])

  // Load Tesseract.js from CDN (once)
  const loadTesseract = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (win.Tesseract) return win.Tesseract

    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script")
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
      s.onload = () => resolve()
      s.onerror = () => reject(new Error("No se pudo cargar Tesseract.js"))
      document.head.appendChild(s)
    })

    if (!win.Tesseract) throw new Error("Tesseract.js no se cargo")
    return win.Tesseract
  }, [])

  // Render a PDF page to a canvas and return a data URL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPageToImage = useCallback(async (page: any, scale = 2): Promise<string> => {
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d")!
    await page.render({ canvasContext: ctx, viewport }).promise
    return canvas.toDataURL("image/png")
  }, [])

  const extractTextFromPdf = useCallback(async (file: File): Promise<string> => {
    setParseStatus("Cargando pdf.js...")
    const pdfjsLib = await loadPdfJs()

    setParseStatus("Leyendo PDF...")
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

    // Always use OCR for reliable text extraction from invoices.
    // pdf.js text extraction produces garbled output for columnar/receipt-style PDFs,
    // while OCR produces clean structured text matching the visual layout.
    setParseStatus("Cargando OCR...")
    const Tesseract = await loadTesseract()

    const ocrParts: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      setParseStatus(`Extrayendo texto de pagina ${i} de ${pdf.numPages}...`)
      const page = await pdf.getPage(i)
      const imageDataUrl = await renderPageToImage(page)
      const result = await Tesseract.recognize(imageDataUrl, "spa", {
        logger: () => {},
      })
      ocrParts.push(result.data.text)
    }

    const ocrText = ocrParts.join("\n").trim()
    if (ocrText.length > 20) {
      return ocrText
    }

    // Fallback: try pdf.js text extraction if OCR produced nothing
    setParseStatus("Extrayendo texto alternativo...")
    const textParts: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((item: any) => item.str != null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.str)
        .join(" ")
      textParts.push(pageText)
    }

    return textParts.join("\n").trim()
  }, [loadPdfJs, loadTesseract, renderPageToImage])

  const extractTextFromImage = useCallback(async (file: File): Promise<string> => {
    setParseStatus("Cargando OCR...")
    const Tesseract = await loadTesseract()

    setParseStatus("Aplicando OCR a imagen...")
    const imageUrl = URL.createObjectURL(file)
    try {
      const result = await Tesseract.recognize(imageUrl, "spa", {
        logger: () => {},
      })
      return result.data.text.trim()
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }, [loadTesseract])

  const handleFile = useCallback(async (file: File) => {
    const name = file.name.toLowerCase()
    const isImage = name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")
    const isPdf = name.endsWith(".pdf")

    if (!isPdf && !isImage) {
      setParseError("Solo se aceptan archivos PDF, JPG o PNG.")
      return
    }

    setIsParsing(true)
    setParseError(null)
    setParseStatus("")
    setParsed(null)
    setSubmitResult(null)
    setOperationType(null)

    try {
      // For images, go straight to OCR. For PDFs, try text extraction first.
      const text = isImage
        ? await extractTextFromImage(file)
        : await extractTextFromPdf(file)

      if (!text || text.trim().length === 0) {
        setParseError("No se pudo extraer texto del archivo. Intente con otro archivo.")
        setIsParsing(false)
        return
      }

      setParseStatus("Analizando datos de factura...")
      // Send extracted text to server for heuristic parsing
      const res = await fetch("/api/invoices/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fileName: file.name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setParseError(data.error || "Error al procesar el PDF.")
        return
      }

      setParsed(data)
      setProviderName(data.providerName || "")
      setCuit(data.cuit || "")
      setAmount(data.amount ? String(data.amount) : "")
      setDate("")
      setCbu("")
      setEmail("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setParseError(`Error de conexion: ${msg}`)
    } finally {
      setIsParsing(false)
    }
  }, [extractTextFromPdf, extractTextFromImage])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleSubmit = async () => {
    if (!operationType || !providerName || !cuit || !amount || !date) return

    setIsSubmitting(true)
    setSubmitResult(null)

    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: operationType,
          providerName,
          cuit,
          amount: parseFloat(amount.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")),
          date,
          cbu: operationType === "transferencia" ? cbu : undefined,
          email: operationType === "cheque" ? email : undefined,
          fileName: parsed?.fileName,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSubmitResult({ success: false, message: data.error || "Error al crear." })
        return
      }

      setSubmitResult({
        success: true,
        message: data.message,
        type: data.type,
        batchId: data.batchId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitResult({ success: false, message: `Error: ${msg}` })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    setParsed(null)
    setParseError(null)
    setParseStatus("")
    setSubmitResult(null)
    setOperationType(null)
    setProviderName("")
    setCuit("")
    setAmount("")
    setDate("")
    setCbu("")
    setEmail("")
    setShowRawText(false)
  }

  const canSubmit =
    operationType &&
    providerName.trim() &&
    cuit.trim() &&
    amount &&
    parseFloat(amount.replace(/[^\d.,]/g, "").replace(",", ".")) > 0 &&
    date &&
    (operationType === "cheque" || cbu.trim())

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 lg:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-foreground text-balance">
              Facturas
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Suba una factura en PDF para crear automaticamente un cheque o una
              transferencia
            </p>
          </div>

          {/* Success result */}
          {submitResult?.success && (
            <div className="mb-6 rounded-lg border border-success/30 bg-success/5 p-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-success mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    {submitResult.message}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {submitResult.type === "transferencia"
                      ? "La transferencia fue agregada a la seccion de Transferencias. Desde ahi puede enviarla al banco."
                      : "El cheque fue agregado a la seccion de Cheques. Desde ahi puede enviarlo al banco para su emision."}
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() =>
                        router.push(
                          submitResult.type === "transferencia"
                            ? `/transfers?batch=${submitResult.batchId}`
                            : `/?batch=${submitResult.batchId}`
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      {submitResult.type === "transferencia"
                        ? "Ir a Transferencias"
                        : "Ir a Cheques"}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleReset}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Cargar otra factura
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Upload zone */}
          {!parsed && !submitResult?.success && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30",
                isParsing && "pointer-events-none opacity-60"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ""
                }}
              />
              {isParsing ? (
                <>
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="mt-4 text-sm font-medium text-foreground">
                    {parseStatus || "Procesando factura..."}
                  </p>
                  {parseStatus.includes("OCR") && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      El OCR puede tardar unos segundos por pagina
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-foreground">
                    Suelte un archivo PDF o imagen aqui, o haga click para seleccionar
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PDF, JPG o PNG -- se extraeran automaticamente los datos de la factura
                  </p>
                </>
              )}
            </div>
          )}

          {parseError && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive">{parseError}</p>
            </div>
          )}

          {/* Parsed data form */}
          {parsed && !submitResult?.success && (
            <div className="mt-6 flex flex-col gap-6">
              {/* Source file info */}
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {parsed.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Datos extraidos -- revise y corrija si es necesario
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cambiar archivo
                </button>
              </div>

              {/* Editable fields */}
              <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Datos de la factura
                  </h2>
                </div>
                <div className="p-4 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        Nombre / Razon Social
                      </label>
                      <input
                        type="text"
                        value={providerName}
                        onChange={(e) => setProviderName(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Nombre del proveedor"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        CUIT
                      </label>
                      <input
                        type="text"
                        value={cuit}
                        onChange={(e) => setCuit(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="20-12345678-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Monto
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <input
                        type="text"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background pl-7 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Operation type selector */}
              <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Tipo de operacion
                  </h2>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setOperationType("cheque")}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 transition-colors",
                        operationType === "cheque"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                      <FileSpreadsheet
                        className={cn(
                          "h-6 w-6",
                          operationType === "cheque"
                            ? "text-primary"
                            : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          operationType === "cheque"
                            ? "text-primary"
                            : "text-foreground"
                        )}
                      >
                        Cheque
                      </span>
                    </button>
                    <button
                      onClick={() => setOperationType("transferencia")}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 transition-colors",
                        operationType === "transferencia"
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                      <ArrowRightLeft
                        className={cn(
                          "h-6 w-6",
                          operationType === "transferencia"
                            ? "text-primary"
                            : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          "text-sm font-medium",
                          operationType === "transferencia"
                            ? "text-primary"
                            : "text-foreground"
                        )}
                      >
                        Transferencia
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Conditional fields based on operation type */}
              {operationType && (
                <div className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      Detalles de{" "}
                      {operationType === "cheque"
                        ? "cheque"
                        : "transferencia"}
                    </h2>
                  </div>
                  <div className="p-4 flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                        <CalendarIcon className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                        Fecha de{" "}
                        {operationType === "cheque" ? "pago" : "envio"}
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    {operationType === "transferencia" && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                          CBU / Alias
                        </label>
                        <input
                          type="text"
                          value={cbu}
                          onChange={(e) => setCbu(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="CBU de 22 digitos o alias"
                        />
                      </div>
                    )}

                    {operationType === "cheque" && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                          Email (opcional)
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="email@ejemplo.com"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Error display */}
              {submitResult && !submitResult.success && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-sm text-destructive">
                    {submitResult.message}
                  </p>
                </div>
              )}

              {/* Submit -- only show when an operation type is selected */}
              {operationType && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || isSubmitting}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors",
                      canSubmit && !isSubmitting
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {isSubmitting && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {operationType === "cheque"
                      ? "Crear Cheque"
                      : "Crear Transferencia"}
                  </button>
                  <button
                    onClick={handleReset}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Prompt to select operation type when none is selected */}
              {!operationType && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    Seleccione un tipo de operacion para continuar
                  </span>
                  <button
                    onClick={handleReset}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Raw text toggle */}
              {parsed.rawText && (
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => setShowRawText(!showRawText)}
                    className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>Texto extraido del PDF</span>
                    <span>{showRawText ? "Ocultar" : "Mostrar"}</span>
                  </button>
                  {showRawText && (
                    <div className="border-t border-border px-4 py-3">
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed font-mono max-h-64 overflow-auto">
                        {parsed.rawText}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
