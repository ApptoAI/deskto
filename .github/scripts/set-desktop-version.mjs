import fs from "node:fs"

const version = process.argv[2]

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("Expected a numeric semantic version, for example 0.1.42")
}

const packagePath = new URL("../../apps/desktop/package.json", import.meta.url)
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))

packageJson.version = version
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
