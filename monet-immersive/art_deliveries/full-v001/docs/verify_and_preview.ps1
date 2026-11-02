$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.png' | Where-Object { $_.FullName -notmatch '\\docs\\' } | Sort-Object FullName)
$report = foreach ($file in $files) {
  $im = [System.Drawing.Bitmap]::FromFile($file.FullName)
  $minAlpha=255; $maxAlpha=0; $nearGray=0; $count=0
  for ($y=0; $y -lt $im.Height; $y+=8) {
    for ($x=0; $x -lt $im.Width; $x+=8) {
      $c=$im.GetPixel($x,$y)
      $minAlpha=[Math]::Min($minAlpha,[int]$c.A)
      $maxAlpha=[Math]::Max($maxAlpha,[int]$c.A)
      if (([Math]::Abs([int]$c.R-[int]$c.G) -le 2) -and ([Math]::Abs([int]$c.R-[int]$c.B) -le 2)) {$nearGray++}
      $count++
    }
  }
  $relative=$file.FullName.Substring($root.Length+1).Replace('\','/')
  $isMap=($relative -match '/masks/|/saliency|/focusability|/value_blocks')
  $row=[pscustomobject]@{
    file=$relative; width=$im.Width; height=$im.Height; bytes=$file.Length
    sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
    sampled_alpha_min=$minAlpha; sampled_alpha_max=$maxAlpha
    sampled_grayscale_fraction=[Math]::Round($nearGray/$count,4)
    exact_scene_size=if($isMap){$im.Width -eq 1774 -and $im.Height -eq 887}else{$null}
    review_status='candidate-not-production-approved'
  }
  $im.Dispose()
  $row
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'file_audit.json') -Encoding utf8
$report | Export-Csv -LiteralPath (Join-Path $PSScriptRoot 'file_audit.csv') -Encoding utf8 -NoTypeInformation
$previewDir=Join-Path $PSScriptRoot 'previews'
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null
function Make-ContactSheet($name,$items,$cols,$cellW,$cellH) {
  $rows=[int][Math]::Ceiling($items.Count/$cols)
  $bmp=New-Object System.Drawing.Bitmap ($cols*$cellW),($rows*$cellH)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(235,235,235))
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $font=New-Object System.Drawing.Font 'Arial',11
  for($i=0;$i -lt $items.Count;$i++) {
    $item=$items[$i]; $im=[System.Drawing.Image]::FromFile((Join-Path $root $item.file))
    $x=($i%$cols)*$cellW; $y=[int][Math]::Floor($i/$cols)*$cellH
    $g.FillRectangle([System.Drawing.Brushes]::White,$x+3,$y+25,$cellW-6,$cellH-30)
    $scale=[Math]::Min(($cellW-12)/$im.Width,($cellH-36)/$im.Height)
    $w=[int]($im.Width*$scale); $h=[int]($im.Height*$scale)
    $g.DrawImage($im,[int]($x+($cellW-$w)/2),[int]($y+27+($cellH-32-$h)/2),$w,$h)
    $g.DrawString($item.file,$font,[System.Drawing.Brushes]::Black,[single]($x+5),[single]($y+3))
    $im.Dispose()
  }
  $bmp.Save((Join-Path $previewDir ($name+'.jpg')),[System.Drawing.Imaging.ImageFormat]::Jpeg)
  $font.Dispose();$g.Dispose();$bmp.Dispose()
}
foreach($scene in @('bridge','regatta')){
  $items=@($report | Where-Object {$_.file.StartsWith($scene+'/') -and $_.file -notmatch '/easter_eggs/'})
  Make-ContactSheet $scene $items 3 480 270
}
Make-ContactSheet 'brushes' @($report | Where-Object {$_.file.StartsWith('brushes/')}) 5 280 310
Make-ContactSheet 'easter_eggs' @($report | Where-Object {$_.file -match '/easter_eggs/'}) 4 320 350
[pscustomobject]@{
  Count=$report.Count
  TotalBytes=($report | Measure-Object bytes -Sum).Sum
  SizeMismatches=@($report | Where-Object {$_.exact_scene_size -eq $false} | Select-Object file,width,height)
  Sprites=@($report | Where-Object {$_.file -match '/easter_eggs/'} | Select-Object file,sampled_alpha_min,sampled_alpha_max)
} | ConvertTo-Json -Depth 6

