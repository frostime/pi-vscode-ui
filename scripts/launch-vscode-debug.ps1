# PowerShell（仓库根目录）
$env:FROSTPI_SOURCEMAP='1'; pnpm build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
code --new-window --disable-extensions `
     --user-data-dir="$PWD/.tmp/vscode-debug" `
     --extensionDevelopmentPath="$PWD/apps/vscode" `
     "$PWD/apps/vscode/test/e2e/fixtures/workspace"