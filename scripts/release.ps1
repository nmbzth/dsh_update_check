# release.ps1 — 发布本插件:契约门 → 提交 → API 推送 → 打 tag(+可选建 GitHub Release)
#
# 发布策略(重要):
#   * 每个版本都打 **tag** —— tag 是自更新抓取内容的锚点,必须存在;
#   * **只有系列最终版本才建 GitHub Release** —— 中间版本发 Release 只会让人一头雾水,
#     而插件自更新以 `releases/latest` 为内容源,最终版本发一次即可。
#   因此:开发过程中反复执行(默认只打 tag);定稿时执行一次 -Final。
#
# 用法(仓库根执行):
#   pwsh -NoProfile -File scripts/release.ps1                 # 中间版本:提交 + 推送 + 打 tag
#   pwsh -NoProfile -File scripts/release.ps1 -Final          # 定稿:额外建 GitHub Release
#   pwsh -NoProfile -File scripts/release.ps1 -Final -Notes "自定义说明"
#   pwsh -NoProfile -File scripts/release.ps1 -SkipPush       # 只提交,不推送/不打 tag
#
# 前置:plugin/package.json 的 version 已 bump,且 CHANGELOG.md 已写好该版本段落
#      (段落内容会被抽出来当作 Release 说明)。
#
# 说明:github.com 的 git 直连在本机不可用(连接超时 / SSL 校验失败),推送走 Git Data API,
#      因此本地与远端的 ref 会「内容一致、SHA 分叉」,这是预期行为。

param(
  [string]$Owner = 'nmbzth',
  [string]$Repo = 'dsh_update_check',
  [string]$Branch = 'main',
  [string]$Notes = '',
  [switch]$Final,
  [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$API = "https://api.github.com/repos/$Owner/$Repo"

$cred = "protocol=https`nhost=github.com`n" | git credential fill 2>$null
$token = (($cred -split "`n") | Where-Object { $_ -like 'password=*' }) -replace '^password=',''
if (-not $token) { throw 'no GitHub credential found in git credential manager' }
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'dsh-update-check-release'; 'Accept' = 'application/vnd.github+json' }

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
  $version = (Get-Content 'plugin/package.json' -Raw | ConvertFrom-Json).version
  $tag = "v$version"
  "VERSION=$version TAG=$tag"

  # 1) 契约门:源码契约 + 运行期契约都必须通过,不允许带着红灯发布
  node scripts/check-src.js | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'check-src.js failed' }
  node scripts/check-runtime.mjs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'check-runtime.mjs failed' }
  'CHECKS=PASS'

  # 2) CHANGELOG 必须已写该版本段落 —— 它同时是 Release 说明的来源
  $changelog = Get-Content 'CHANGELOG.md' -Raw
  if ($changelog -notmatch [regex]::Escape($version)) { throw "CHANGELOG.md 缺少 $version 段落" }
  $section = ''
  $m = [regex]::Match($changelog, "(?ms)^##\s*v?\[?$([regex]::Escape($version))\]?.*?$\n(.*?)(?=^##\s|\z)")
  if ($m.Success) { $section = $m.Groups[1].Value.Trim() }
  $body = if ($Notes) { $Notes } elseif ($section) { $section } else { "Release $tag" }
  "NOTES_SOURCE=$(if ($Notes) { 'arg' } elseif ($section) { "changelog:$($section.Length)chars" } else { 'fallback' })"

  # 3) 提交本地改动
  git add -A
  if ((git status --porcelain)) {
    git commit -m "release: v$version" | Out-Null
    "COMMITTED=$(git rev-parse --short HEAD)"
  } else {
    'COMMITTED=no-changes'
  }

  # 4) 推送(API 通道)
  $headSha = (git rev-parse HEAD).Trim()
  if (-not $SkipPush) {
    pwsh -NoProfile -File (Join-Path $PSScriptRoot 'push-via-api.ps1') -Owner $Owner -Repo $Repo -Branch $Branch
    $headSha = (Api 'GET' "$API/git/ref/heads/$Branch" $null).object.sha
  }
  "HEAD=$($headSha.Substring(0,7))"

  if ($SkipPush) { 'SKIPPED_PUSH (tag/release not created)'; return }

  # 5) 打 tag(幂等:已存在则跳过)
  $tagExists = $true
  try { Api 'GET' "$API/git/ref/tags/$tag" $null | Out-Null } catch { $tagExists = $false }
  if ($tagExists) {
    "TAG=$tag already-exists"
  } else {
    Api 'POST' "$API/git/refs" @{ ref = "refs/tags/$tag"; sha = $headSha } | Out-Null
    "TAG=$tag created"
  }

  # 6) 建 Release —— 仅系列最终版本(-Final);幂等:已存在则跳过
  if (-not $Final) {
    "RELEASE=skipped (中间版本只打 tag;定稿时加 -Final 发布 Release)"
  } else {
    $releaseExists = $true
    try { Api 'GET' "$API/releases/tags/$tag" $null | Out-Null } catch { $releaseExists = $false }
    if ($releaseExists) {
      "RELEASE=https://github.com/$Owner/$Repo/releases/tag/$tag (already-exists)"
    } else {
      $rel = Api 'POST' "$API/releases" @{
        tag_name   = $tag
        name       = $tag
        body       = $body
        draft      = $false
        prerelease = ($version -match '-')
      }
      "RELEASE=$($rel.html_url)"
    }
  }
  'DONE'
} finally {
  Pop-Location
}
