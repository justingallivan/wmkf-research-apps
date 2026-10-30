#!/usr/bin/env bash
# Offline build/check runner. Restore uses public NuGet only; no tenant/login.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/.." && pwd)
sdk_command=${PR553_DOTNET:-dotnet}
export DOTNET_CLI_HOME="${TMPDIR:-/tmp}/wmkf-prompt-sdk-cli"
export NUGET_PACKAGES="${PR553_NUGET_CACHE:-${TMPDIR:-/tmp}/wmkf-prompt-sdk-nuget}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
node "$repo_root/scripts/build-prompt-publication-wire-vectors.cjs" --check
node "$repo_root/scripts/build-prompt-publication-definition-vectors.cjs" --check
cd "$repo_root/dataverse/prompt-publication"
"$sdk_command" restore Checks/Checks.csproj --locked-mode --configfile NuGet.Config
"$sdk_command" build Transport/Transport.csproj --no-restore --configuration Release
"$sdk_command" build Checks/Checks.csproj --no-restore --configuration Release
"$sdk_command" run --framework net8.0 --project Checks/Checks.csproj --no-restore --configuration Release -- "$repo_root/tests/fixtures/prompt-publication/fingerprints-v1.json"
node "$repo_root/scripts/build-prompt-publication-rehearsal.cjs" --check
