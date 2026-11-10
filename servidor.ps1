param(
    [int]$Porta = 8137,
    [string]$Raiz = ""
)

# Servidor web minimo (socket TCP, sin permisos de administrador)
# para jugar "Escapa de los Profesores" desde el navegador.
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Raiz)) { $Raiz = $PSScriptRoot }
$raizAbs = (Resolve-Path $Raiz).Path

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Porta)
$listener.Start()
Write-Host ""
Write-Host "  ESCAPA DE LOS PROFESORES"
Write-Host "  Servidor listo en  http://localhost:$Porta"
Write-Host "  Sirviendo: $raizAbs"
Write-Host "  Ctrl+C para apagar."
Write-Host ""

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)

        $request = $reader.ReadLine()
        while ($true) {
            $h = $reader.ReadLine()
            if ($null -eq $h -or $h -eq "") { break }
        }
        if ([string]::IsNullOrWhiteSpace($request)) { $client.Close(); continue }

        $target = ($request -split " ")[1]
        $target = ($target -split "\?")[0]
        $rel = [System.Uri]::UnescapeDataString($target.TrimStart("/"))
        if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

        $destino = Join-Path $raizAbs ($rel -replace "/", "\")
        $full = $null
        try { $full = (Resolve-Path -LiteralPath $destino -ErrorAction Stop).Path } catch { $full = $null }

        if ($full -and $full.StartsWith($raizAbs) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($full).ToLower()
            $tipo = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($full)
            $cabecera = "HTTP/1.1 200 OK`r`nContent-Type: $tipo`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        }
        else {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("No encontrado: $rel")
            $cabecera = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
        }

        $hb = [System.Text.Encoding]::ASCII.GetBytes($cabecera)
        $stream.Write($hb, 0, $hb.Length)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $client.Close()
    }
    catch {
        if ($client) { $client.Close() }
    }
}
