param([string]$Out, [int]$Seconds = 2400)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$last = ""
$end = (Get-Date).AddSeconds($Seconds)
"start $(Get-Date -Format o)" | Out-File -FilePath $Out -Encoding utf8
while ((Get-Date) -lt $end) {
  $h = [Fg]::GetForegroundWindow()
  $p = 0
  [void][Fg]::GetWindowThreadProcessId($h, [ref]$p)
  $sb = New-Object System.Text.StringBuilder 256
  [void][Fg]::GetWindowText($h, $sb, 256)
  $name = try { (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { "?" }
  $cur = "$name | $($sb.ToString())"
  if ($cur -ne $last) {
    "$(Get-Date -Format HH:mm:ss.fff) $cur" | Out-File -FilePath $Out -Append -Encoding utf8
    $last = $cur
  }
  Start-Sleep -Milliseconds 150
}
"end $(Get-Date -Format o)" | Out-File -FilePath $Out -Append -Encoding utf8
