/// Provenance vocabulary shared across all Intel packages.
/// Thin, zero-runtime-dependency module.

/** Confidence that a fact was observed from source. */
export enum EvidenceLevel {
  Verified = "verified",
  StronglySupported = "strongly_supported",
  Inferred = "inferred",
  Unknown = "unknown",
}

const PRISMA_TO_ENUM: Record<string, EvidenceLevel> = {
  verified: EvidenceLevel.Verified,
  strongly_supported: EvidenceLevel.StronglySupported,
  inferred: EvidenceLevel.Inferred,
  unknown: EvidenceLevel.Unknown,
  VERIFIED: EvidenceLevel.Verified,
  STRONGLY_SUPPORTED: EvidenceLevel.StronglySupported,
  INFERRED: EvidenceLevel.Inferred,
  UNKNOWN: EvidenceLevel.Unknown,
}

/** Convert a string (from Prisma or elsewhere) into the EvidenceLevel enum.
 *  Throws on any value that doesn't match a known EvidenceLevel so that a
 *  typo or schema drift can't hide behind EvidenceLevel.Unknown. */
export function toEvidenceLevel(v: string): EvidenceLevel {
  const mapped = PRISMA_TO_ENUM[v]
  if (!mapped) {
    throw new Error(
      `toEvidenceLevel: unrecognized EvidenceLevel string "${v}"`,
    )
  }
  return mapped
}

/** Convert an EvidenceLevel enum value to its string form (used by Prisma). */
export function evidenceLevelToString(level: EvidenceLevel): string {
  return level
}

export interface ProvenanceData {
  sourcePath: string
  sourceCommitSha: string | null
  retrievedAt: Date
  evidenceLevel: EvidenceLevel
}

/** Build a provenance object for DB writes. */
export function createProvenance(
  sourcePath: string,
  sourceCommitSha: string | null,
  level: EvidenceLevel = EvidenceLevel.Verified,
): ProvenanceData {
  return {
    sourcePath,
    sourceCommitSha,
    retrievedAt: new Date(),
    evidenceLevel: level,
  }
}

/** True when the level is Verified or StronglySupported. */
export function isVerifiedOrStronger(level: EvidenceLevel): boolean {
  return level === EvidenceLevel.Verified || level === EvidenceLevel.StronglySupported
}
