-- Baseline migration: the schema as of the first deploy.
-- Generated with `prisma migrate diff --from-empty --to-schema schemas/graph.prisma --script`.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('verified', 'strongly_supported', 'inferred', 'unknown');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('file', 'commit', 'human_statement', 'inferred_pattern');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('REPOSITORY', 'PACKAGE', 'MODULE', 'SYMBOL', 'DOCUMENT', 'DECISION');

-- CreateEnum
CREATE TYPE "RelationshipKind" AS ENUM ('CONTAINS', 'CONSUMES', 'DEPENDS_ON', 'RENAMED_FROM', 'DOCUMENTS', 'EXPORTS', 'DEFINES', 'REFERENCES', 'GOVERNS', 'VIOLATES');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('dependency', 'dev', 'peer', 'optional');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "defaultBranch" TEXT,
    "sourcePath" TEXT NOT NULL DEFAULT '.',
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "repositoryId" TEXT NOT NULL,
    "dependencies" JSONB,
    "devDependencies" JSONB,
    "peerDependencies" JSONB,
    "optionalDependencies" JSONB,
    "sourcePath" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "repositoryId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Symbol" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT,
    "repositoryId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Symbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "path" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT,
    "repositoryId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourcePath" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'human_statement',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "packagesCount" INTEGER NOT NULL DEFAULT 0,
    "modulesCount" INTEGER NOT NULL DEFAULT 0,
    "documentsCount" INTEGER NOT NULL DEFAULT 0,
    "symbolsCount" INTEGER NOT NULL DEFAULT 0,
    "symbolFilesParsed" INTEGER NOT NULL DEFAULT 0,
    "symbolFilesSkipped" INTEGER NOT NULL DEFAULT 0,
    "symbolFilesErrored" INTEGER NOT NULL DEFAULT 0,
    "consumesEdges" INTEGER NOT NULL DEFAULT 0,
    "containsEdges" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT,
    "warningsJson" TEXT,
    "sourcePath" TEXT NOT NULL DEFAULT 'ingest',
    "sourceType" "SourceType" NOT NULL DEFAULT 'inferred_pattern',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "fromEntityType" "EntityType" NOT NULL,
    "toEntityType" "EntityType" NOT NULL,
    "kind" "RelationshipKind" NOT NULL,
    "note" TEXT,
    "depType" "DependencyType",
    "sourcePath" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'file',
    "sourceCommitSha" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "evidenceLevel" "EvidenceLevel" NOT NULL DEFAULT 'verified',

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_name_key" ON "Repository"("name");

-- CreateIndex
CREATE INDEX "Package_name_idx" ON "Package"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Package_repositoryId_name_key" ON "Package"("repositoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Module_repositoryId_path_key" ON "Module"("repositoryId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Symbol_repositoryId_path_name_key" ON "Symbol"("repositoryId", "path", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_repositoryId_path_key" ON "Document"("repositoryId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_key_key" ON "Decision"("key");

-- CreateIndex
CREATE INDEX "IngestionRun_repositoryId_startedAt_idx" ON "IngestionRun"("repositoryId", "startedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_commitSha_idx" ON "IngestionRun"("commitSha");

-- CreateIndex
CREATE INDEX "Relationship_fromEntityId_fromEntityType_idx" ON "Relationship"("fromEntityId", "fromEntityType");

-- CreateIndex
CREATE INDEX "Relationship_toEntityId_toEntityType_idx" ON "Relationship"("toEntityId", "toEntityType");

-- CreateIndex
CREATE INDEX "Relationship_kind_idx" ON "Relationship"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_fromEntityId_toEntityId_fromEntityType_toEntit_key" ON "Relationship"("fromEntityId", "toEntityId", "fromEntityType", "toEntityType", "kind");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Symbol" ADD CONSTRAINT "Symbol_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
