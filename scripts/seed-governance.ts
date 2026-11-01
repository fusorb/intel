import { prisma } from "@fusorb/intel-graph"
import { runGovernance } from "@fusorb/intel-ingest"

/** Seed the authored ecosystem Decisions and (re)compute governance edges. */
async function main(): Promise<void> {
  const summary = await runGovernance()
  console.log(
    `governance seeded: ${summary.decisions} decisions, ` +
      `${summary.governsEdges} GOVERNS edges, ${summary.violations} VIOLATES edges`,
  )
  await prisma.$disconnect()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
