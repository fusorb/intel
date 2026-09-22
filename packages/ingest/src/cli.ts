#!/usr/bin/env node
import { Command } from "commander"
import { prisma } from "@fusorb/intel-graph"
import { ingestRepo } from "./ingest.js"
import type { IngestSummary } from "./types.js"

async function report(summary: IngestSummary): Promise<void> {
  const short = summary.commitSha.slice(0, 7)
  console.log(
    `ingested ${summary.repo} @ ${short}: ` +
      `${summary.packages} packages, ${summary.modules} modules, ${summary.documents} documents, ` +
      `${summary.symbols} symbols, ` +
      `${summary.consumesEdges} CONSUMES edges, ${summary.containsEdges} CONTAINS edges`,
  )
}

const program = new Command()
program
  .name("intel-ingest")
  .description("Clone a Fusorb repository and ingest it into the Intel knowledge graph")
  .argument("<url>", "git repository URL to ingest")
  .option("-b, --branch <branch>", "branch to ingest instead of the default")
  .action(async (url: string, options: { branch?: string }) => {
    const summary = await ingestRepo(url, options.branch ?? null)
    await report(summary)
    await prisma.$disconnect()
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
