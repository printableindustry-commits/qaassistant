# Rend chaque slide d'un .pptx en PNG (et optionnellement en PDF) via PowerPoint (COM).
# Usage : powershell -File rendre-slides.ps1 -Pptx <chemin.pptx> -Sortie <dossier> [-Pdf <chemin.pdf>]
param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$Sortie,
  [string]$Pdf = ""
)
$ErrorActionPreference = "Stop"
$Pptx = (Resolve-Path $Pptx).Path
New-Item -ItemType Directory -Force $Sortie | Out-Null
$Sortie = (Resolve-Path $Sortie).Path
$app = New-Object -ComObject PowerPoint.Application
try {
  # Open(FileName, ReadOnly, Untitled, WithWindow)
  $pres = $app.Presentations.Open($Pptx, -1, 0, 0)
  try {
    $n = $pres.Slides.Count
    for ($i = 1; $i -le $n; $i++) {
      $png = Join-Path $Sortie ("slide-{0:D2}.png" -f $i)
      $pres.Slides.Item($i).Export($png, "PNG", 1600, 900)
    }
    Write-Output "$n slides rendues dans $Sortie"
    if ($Pdf -ne "") {
      $pres.SaveAs($Pdf, 32)  # ppSaveAsPDF
      Write-Output "PDF : $Pdf"
    }
  } finally { $pres.Close() }
} finally {
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
