# echeck-creator-system

App Next.js para subir un Excel con cheques, visualizar lotes y (opcionalmente) emitirlos automáticamente en Banco Galicia usando Puppeteer.

## Requisitos
- Node.js 18+ (recomendado 20+)
- pnpm
- Google Chrome instalado (en Windows se usa: `C:/Program Files/Google/Chrome/Application/chrome.exe`)

## Instalación
```bash
pnpm install
```

## Variables de entorno
Crear un archivo `.env.local` (o exportar variables) con:

```bash
GALICIA_USER=...
GALICIA_PASS=...

# Opcional: post-"Continuar" (acepta TyC y espera que un humano ingrese el codigo)
OTP_WAIT_MS=600000
OTP_DETECT_TIMEOUT_MS=180000
```

> Consejo: usar un usuario “técnico” del banco con permisos mínimos.

## Correr en desarrollo (Windows)

En PowerShell 5.1 el operador `&&` puede fallar. Usá una de estas opciones:

**Opción A (PowerShell):**
```powershell
pnpm install; pnpm dev
```

**Opción B (CMD desde PowerShell):**
```powershell
cmd /c "pnpm install && pnpm dev"
```

**Opción C (PowerShell 7+):**
Actualizar a PowerShell 7 y ahí sí funciona `&&`.

Luego abrir: http://localhost:3000

## Notas
- Los lotes se guardan en `.data/batches.json` (modo simple local/dev).
- La automatización abre Chrome en modo visible (`headless: false`) y guarda screenshots en `debug-screenshots/`.
- Luego de cargar cheques y hacer click en **Continuar**, el script intenta **aceptar Términos y Condiciones** (si aparecen) y queda esperando para que un humano ingrese el **código de seguridad** en el navegador.
