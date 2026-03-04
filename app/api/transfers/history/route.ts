import { NextResponse } from "next/server"
import { getTransferOperationLogs } from "@/lib/transfer-store"

export async function GET() {
  const logs = getTransferOperationLogs()
  return NextResponse.json(logs)
}
