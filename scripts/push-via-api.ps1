# push-via-api.ps1 — 当 github.com 的 git 直连不可用(连接超时 / SSL 校验失败)时的备用推送。
#
# 走 api.github.com 的 Git Data API:用本地文件的 git blob sha 与远端 tree 逐文件比对,只推送内容不同的文件,
# 再创建 tree/commit 并更新分支 ref。不依赖本地是否拥有远端 commit 对象,可反复使用。
# 凭据从 git credential(GCM)读取,不落盘。
#
# 用法(在仓库根执行):
#   pwsh -NoProfile -File scripts/push-via-api.ps1
#   pwsh -NoProfile -File scripts/push-via-api.ps1 -Owner someone -Repo some_repo -Branch main
#
# 注意:API 创建的提交 SHA 与本地提交不同(内容相同),因此推送后本地与远端 ref 会「内容一致、SHA 分叉」;
# 后续改动继续用本脚本推送即可(它始终以远端 HEAD 为 parent)。删除文件暂不支持。

param(
  [string]$Owner = 'nmbzth',
  [string]$Repo = 'dsh_update_check',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$API = "https://api.github.com/repos/$Owner/$Repo"

$cred = "protocol=https`nhost=github.com`n" | git credential fill 2>$null
$token = (($cred -split "`n") | Where-Object { $_ -like 'password=*' }) -replace '^password=',''
if (-not $token) { throw 'no GitHub credential found in git credential manager' }
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'dsh-update-check-push'; 'Accept' = 'application/vnd.github+json' }

function Api($method, $url, $bodyObj) {
  $p = @{ Method = $method; Uri = $url; Headers = $headers; TimeoutSec = 30 }
  if ($null -ne $bodyObj) {
    $p.Body = [Text.Encoding]::UTF8.GetBytes(($bodyObj | ConvertTo-Json -Depth 10 -Compress))
    $p.ContentType = 'application/json'
  }
  Invoke-RestMethod @p
}

Push-Location $ROOT
try {
  $ref = Api 'GET' "$API/git/ref/heads/$Branch" $null
  $headSha = $ref.object.sha
  $headCommit = Api 'GET' "$API/git/commits/$headSha" $null
  $remoteTree = Api 'GET' "$API/git/trees/$($headCommit.tree.sha)?recursive=1" $null
  $remote = @{}
  foreach ($entry in $remoteTree.tree) { if ($entry.type -eq 'blob') { $remote[$entry.path] = $entry.sha } }

  $message = (git log -1 --pretty=%B) -join "`n"
  $localFiles = @((git ls-files) | Where-Object { $_ })
  $changed = @()
  foreach ($file in $localFiles) {
    $sha = (git hash-object $file).Trim()
    if ($remote.ContainsKey($file) -and $remote[$file] -eq $sha) { continue }
    $changed += $file
  }
  "REMOTE_HEAD=$($headSha.Substring(0,7)) FILES=$($localFiles.Count) CHANGED=$($changed.Count)"
  if ($changed.Count -eq 0) { 'ALREADY-IN-SYNC (all tracked files match remote)'; return }

  $tree = @()
  foreach ($file in $changed) {
    $abs = Join-Path $ROOT ($file -replace '/', '\')
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($abs))
    $blob = Api 'POST' "$API/git/blobs" @{ content = $b64; encoding = 'base64' }
    $tree += @{ path = $file; mode = '100644'; type = 'blob'; sha = $blob.sha }
    "BLOB $file -> $($blob.sha.Substring(0,7))"
  }
  $newTree = Api 'POST' "$API/git/trees" @{ base_tree = $headCommit.tree.sha; tree = $tree }
  $newCommit = Api 'POST' "$API/git/commits" @{ message = $message; tree = $newTree.sha; parents = @($headSha) }
  Api 'PATCH' "$API/git/refs/heads/$Branch" @{ sha = $newCommit.sha } | Out-Null
  "PUSHED_VIA_API=$($newCommit.sha)"
} finally {
  Pop-Location
}
