/**
 * Sample TypeScript source file used to exercise the symbol parser.
 * Contains a representative mix of declarations, imports and exports.
 */

import { readFileSync } from "node:fs"
import React, { type ReactNode, useState } from "react"
import * as path from "node:path"
import type { ZodSchema } from "zod"

/** A greeting function. */
export function greet(name: string): string {
  return `Hello, ${name}!`
}

export async function asyncGreet(name: string): Promise<string> {
  return greet(name)
}

export class Greeter {
  readonly name: string
  private count: number = 0

  constructor(name: string) {
    this.name = name
  }

  greet(): string {
    this.count++
    return greet(this.name)
  }

  get label(): string {
    return this.name
  }
}

export interface GreeterOptions {
  name: string
  greeting?: string
}

export type GreeterResult = string | number

export const DEFAULT_NAME = "World"

export enum Status {
  Active,
  Inactive,
  Pending,
}

function internalHelper(value: unknown): boolean {
  return typeof value === "string"
}

const ARROW_FN = (x: number): number => x * 2

export { DEFAULT_NAME as DEFAULT_GREETING }
export { greet as default }
