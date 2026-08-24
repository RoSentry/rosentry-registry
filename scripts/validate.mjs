// Validate every data file in this repo.
//
// This repo has no build and no tests — it is pure data that other services
// read: services.json and versions.json are consumed as the source of truth for
// what exists and at which version, and ledger/*.jsonl is an append-only log
// per service. A malformed file here does not fail here; it fails in whatever
// service parses it next, which is the wrong place to find out.
//
// Checks, deliberately cheap so this can gate every PR:
//   - services.json / versions.json parse as JSON and are objects
//   - every ledger/*.jsonl has one complete JSON value per non-blank line
//     (the failure mode a truncated append actually produces)
//   - no duplicate keys inside a single JSON object, which JSON.parse silently
//     accepts by keeping the last one

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const failures = []

function fail(file, line, why) {
  failures.push({ file, line, why })
}

// JSON.parse accepts duplicate keys and keeps the last value, so a ledger entry
// that accidentally repeats a field parses clean and silently loses data.
// Re-scan the raw text for repeated keys at the same nesting depth.
function duplicateKeys(raw) {
  const dupes = []
  const stack = [new Set()]
  let inString = false, escaped = false, depth = 0
  let current = '', capturing = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inString) {
      if (escaped) { escaped = false; if (capturing) current += c; continue }
      if (c === '\\') { escaped = true; continue }
      if (c === '"') {
        inString = false
        if (capturing) {
          // A string is a KEY only when the next non-space character is a colon.
          let j = i + 1
          while (j < raw.length && /\s/.test(raw[j])) j++
          if (raw[j] === ':') {
            if (stack[depth].has(current)) dupes.push(current)
            stack[depth].add(current)
          }
          current = ''; capturing = false
        }
        continue
      }
      if (capturing) current += c
      continue
    }
    if (c === '"') { inString = true; capturing = true; current = ''; continue }
    if (c === '{') { depth++; stack[depth] = new Set(); continue }
    if (c === '}') { if (depth > 0) { delete stack[depth]; depth-- } continue }
  }
  return dupes
}

function checkJsonFile(file) {
  if (!existsSync(file)) { fail(file, 0, 'expected file is missing'); return }
  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    fail(file, 0, `invalid JSON: ${e.message}`); return
  }
  if (parsed === null || typeof parsed !== 'object') {
    fail(file, 0, `expected an object or array at the top level, got ${typeof parsed}`)
  }
  for (const k of duplicateKeys(raw)) fail(file, 0, `duplicate key "${k}"`)
}

function checkJsonlFile(file) {
  const raw = readFileSync(file, 'utf8')
  raw.split('\n').forEach((line, idx) => {
    if (line.trim() === '') return
    try {
      const v = JSON.parse(line)
      if (v === null || typeof v !== 'object') {
        fail(file, idx + 1, 'each ledger line must be a JSON object')
      }
    } catch (e) {
      fail(file, idx + 1, `invalid JSON: ${e.message}`)
    }
    for (const k of duplicateKeys(line)) fail(file, idx + 1, `duplicate key "${k}"`)
  })
}

checkJsonFile('services.json')
checkJsonFile('versions.json')

// readdirSync({recursive:true}) rather than fs.globSync: globSync landed in
// Node 22 and CI runs Node 20.
let ledger = []
try {
  ledger = readdirSync('ledger', { recursive: true })
    .map(p => join('ledger', String(p)))
    .filter(p => p.endsWith('.jsonl'))
} catch { /* no ledger directory — not an error on its own */ }

for (const f of ledger) checkJsonlFile(f)

const checked = 2 + ledger.length
if (failures.length === 0) {
  console.log(`OK  ${checked} data files valid (services.json, versions.json, ${ledger.length} ledger files)`)
  process.exit(0)
}

console.error(`FAIL  ${failures.length} problem(s):\n`)
for (const f of failures) {
  console.error(`  ${f.file}${f.line ? ':' + f.line : ''}  ${f.why}`)
}
process.exit(1)
