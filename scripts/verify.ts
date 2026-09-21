import { prisma } from "../packages/graph/src/index.ts"

/** Verification harness: asserts the 3 acceptance facts against real data. */

interface Fact {
  name: string
  passed: boolean
  detail: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return null
}

/** Collect every dependency + devDependency name declared by a repository's packages. */
async function dependencyNames(repoName: string): Promise<string[]> {
  const rows = await prisma.package.findMany({
    where: { repository: { name: repoName } },
    select: { dependencies: true, devDependencies: true },
  })
  const names: string[] = []
  for (const row of rows) {
    for (const k of Object.keys(asRecord(row.dependencies) ?? {})) names.push(k)
    for (const k of Object.keys(asRecord(row.devDependencies) ?? {})) names.push(k)
  }
  return names
}

async function main(): Promise<void> {
  const facts: Fact[] = []

  // Fact 1: SovGrant's manifests reference @arcevo/facet-* and NOT @fusorb/facet-*.
  {
    const deps = await dependencyNames("sovgrant")
    const hasArcevo = deps.some((n) => /^@arcevo\/facet-/.test(n))
    const hasFusorbFacet = deps.some((n) => /^@fusorb\/facet/.test(n))
    facts.push({
      name: "SovGrant references @arcevo/facet-* (not @fusorb/facet-*)",
      passed: hasArcevo && !hasFusorbFacet,
      detail: `@arcevo/facet-* present = ${hasArcevo}; @fusorb/facet-* present = ${hasFusorbFacet}`,
    })
  }

  // Fact 2: Facet ships packages/ motion, native, sandbox as Package entities.
  {
    const packages = await prisma.package.findMany({
      where: { repository: { name: "facet" } },
      select: { sourcePath: true, name: true },
    })
    const has = (segment: string) =>
      packages.some((p) => new RegExp(`packages/${segment}/`).test(p.sourcePath))
    const ok = has("motion") && has("native") && has("sandbox")
    facts.push({
      name: "Facet has Package entities for packages/ motion, native, sandbox",
      passed: ok,
      detail: `facet packages: ${packages.map((p) => p.sourcePath).join(", ") || "(none)"}`,
    })
  }

  // Fact 3: Relnex depends on shadcn-related packages, not @fusorb/facet-components.
  {
    const deps = await dependencyNames("relnex")
    const shadcnRelated = deps.filter(
      (n) => /shadcn/i.test(n) || /^@radix-ui\//.test(n) || n === "lucide-react" || n === "clsx" || n === "tailwind-merge",
    )
    const hasShadcn = shadcnRelated.length > 0
    const hasFusorbComponents = deps.includes("@fusorb/facet-components")
    facts.push({
      name: "Relnex depends on shadcn-related packages (not @fusorb/facet-components)",
      passed: hasShadcn && !hasFusorbComponents,
      detail: `shadcn-related deps [${shadcnRelated.join(", ")}]; @fusorb/facet-components present = ${hasFusorbComponents}`,
    })
  }

  let allPassed = true
  for (const fact of facts) {
    console.log(`[${fact.passed ? "PASS" : "FAIL"}] ${fact.name}`)
    console.log(`        ${fact.detail}`)
    if (!fact.passed) allPassed = false
  }
  console.log(`\n${facts.filter((f) => f.passed).length}/${facts.length} acceptance facts passed`)
  process.exit(allPassed ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
