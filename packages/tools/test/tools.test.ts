import { describe, it, expect } from "vitest"
import {
  getToolDefinitions,
  executeTool,
  registerTool,
} from "@fusorb/intel-tools"

describe("tool registry", () => {
  it("exposes the default read-only tool surface", () => {
    const names = getToolDefinitions().map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "search_repo",
        "read_document",
        "inspect_dependencies",
        "find_symbol",
        "find_callers",
        "find_references",
      ]),
    )
  })

  it("every tool has a name, description, parameters, and handler", () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(Array.isArray(tool.parameters)).toBe(true)
      expect(typeof tool.handler).toBe("function")
      for (const p of tool.parameters) {
        expect(p.name).toBeTruthy()
        expect(p.type).toBeTruthy()
        expect(p.description).toBeTruthy()
      }
    }
  })

  it("find_symbol declares a required name parameter", () => {
    const tool = getToolDefinitions().find((t) => t.name === "find_symbol")
    expect(tool).toBeDefined()
    const nameParam = tool!.parameters.find((p) => p.name === "name")
    expect(nameParam).toBeDefined()
    expect(nameParam!.required).toBe(true)
  })

  it("executeTool throws for an unknown tool", async () => {
    await expect(executeTool("nope", {})).rejects.toThrow(/Unknown tool/)
  })

  it("executeTool dispatches to a registered tool", async () => {
    registerTool({
      name: "test_registry_echo",
      description: "test-only echo",
      parameters: [{ name: "v", type: "string", description: "value", required: true }],
      handler: async (args) => ({ echoed: args.v }),
    })
    const result = await executeTool("test_registry_echo", { v: "x" })
    expect(result).toEqual({ echoed: "x" })
  })

  it("executeTool rejects a call missing a required argument", async () => {
    registerTool({
      name: "test_registry_requires",
      description: "test-only required arg",
      parameters: [{ name: "v", type: "string", description: "value", required: true }],
      handler: async (args) => ({ echoed: args.v }),
    })
    await expect(executeTool("test_registry_requires", {})).rejects.toThrow(
      /missing required argument: v/,
    )
    await expect(executeTool("test_registry_requires", { v: "  " })).rejects.toThrow(
      /missing required argument: v/,
    )
  })
})
