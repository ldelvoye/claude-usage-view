#!/usr/bin/env bash
# Build a .vsix without vsce: it is just a zip with an OPC manifest alongside
# the extension payload.
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY'
import json, zipfile, pathlib

root = pathlib.Path.cwd()
pkg = json.loads((root / "package.json").read_text())
name, publisher, version = pkg["name"], pkg["publisher"], pkg["version"]

content_types = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="sh" ContentType="text/plain"/>
  <Default Extension="xml" ContentType="text/xml"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
</Types>
"""

manifest = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}"/>
    <DisplayName>{pkg["displayName"]}</DisplayName>
    <Description xml:space="preserve">{pkg["description"]}</Description>
    <Tags>claude,usage,sidebar,statusline</Tags>
    <Categories>{",".join(pkg["categories"])}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg["engines"]["vscode"]}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="{",".join(pkg.get("extensionDependencies", []))}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace"/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  </Assets>
</PackageManifest>
"""

# Every runtime file, by name. A missing lib/ entry still produces a valid
# archive that activates and then throws on require, so the build asserts.
payload = [
    "package.json",
    "extension.js",
    "statusline.sh",
    "README.md",
    "lib/usage.js",
    "lib/setup.js",
    "lib/render.js",
]

missing = [f for f in payload if not (root / f).exists()]
if missing:
    raise SystemExit("refusing to build, missing: " + ", ".join(missing))

out = root / f"{name}-{version}.vsix"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("extension.vsixmanifest", manifest)
    for f in payload:
        z.write(root / f, f"extension/{f}")

print(f"built {out.name} ({len(payload)} files)")
PY
