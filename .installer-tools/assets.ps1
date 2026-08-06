Add-Type -AssemblyName System.Drawing
$root = 'C:\Users\sobri\OneDrive\Desktop\Reimagined'
$logoPath = Join-Path $root 'Logo\Reimagined_Launcher.png'
$out = Join-Path $root '.installer-tools\assets'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$logo = [System.Drawing.Image]::FromFile($logoPath)

function Save-24($bmp, $name) {
  $rect = New-Object System.Drawing.Rectangle 0,0,$bmp.Width,$bmp.Height
  $b24 = $bmp.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $b24.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Bmp)
  $b24.Dispose(); $bmp.Dispose()
}

# header 150x57 - purple band + white Reimagined wordmark
$h = New-Object System.Drawing.Bitmap 150,57
$g = [System.Drawing.Graphics]::FromImage($h)
$r = New-Object System.Drawing.Rectangle 0,0,150,57
$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($r, [System.Drawing.Color]::FromArgb(255,109,40,217), [System.Drawing.Color]::FromArgb(255,40,14,84), 0)
$g.FillRectangle($br, $r); $br.Dispose()
$f = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$sb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('Reimagined', $f, $sb, (New-Object System.Drawing.RectangleF 0,0,150,57), $fmt)
$f.Dispose(); $sb.Dispose(); $fmt.Dispose(); $g.Dispose()
Save-24 $h 'header.bmp'

# bg 480x360 - dark purple solid + accent + watermark
$b = New-Object System.Drawing.Bitmap 480,360
$g = [System.Drawing.Graphics]::FromImage($b)
$g.Clear([System.Drawing.Color]::FromArgb(255,18,12,40))
$line = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,124,58,237))
$g.FillRectangle($line, 0, 0, 480, 3); $line.Dispose()
$glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26,124,58,237))
$g.FillEllipse($glow, 300, -70, 340, 340); $glow.Dispose()
$wmH = 58
$wmW = [int]($wmH * ($logo.Width / $logo.Height))
$g.DrawImage($logo, 480-$wmW-24, 360-$wmH-18, $wmW, $wmH)
$g.Dispose()
Save-24 $b 'bg.bmp'

# bg-welcome 480x360 - gradient + big centered logo
$w = New-Object System.Drawing.Bitmap 480,360
$g = [System.Drawing.Graphics]::FromImage($w)
$r = New-Object System.Drawing.Rectangle 0,0,480,360
$br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($r, [System.Drawing.Color]::FromArgb(255,26,17,58), [System.Drawing.Color]::FromArgb(255,96,36,196), 90)
$g.FillRectangle($br, $r); $br.Dispose()
$glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45,255,255,255))
$g.FillEllipse($glow, [int]((480-240)/2), 18, 240, 180); $glow.Dispose()
$lh = 96
$lw = [int]($lh * ($logo.Width / $logo.Height))
$g.DrawImage($logo, [int]((480-$lw)/2), 48, $lw, $lh)
$g.Dispose()
Save-24 $w 'bg-welcome.bmp'

Write-Output 'ASSETS_OK'
