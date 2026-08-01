import { describe, expect, it } from "vitest";
import {
  buildToolCapabilityInstructions,
  resolveToolCapabilities
} from "../src/toolCapabilities";

describe("resolveToolCapabilities", () => {
  it("links a virtual workspace URI resolver to a Copilot editor", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "get_object_workspace_uri",
        description: "Returns a virtual workspace URI usable with standard file operations."
      },
      {
        name: "apply_patch",
        description: "Apply a patch to a file."
      },
      {
        name: "copilot_getErrors",
        description: "Get syntax errors for a resource."
      }
    ]);

    expect(capabilities.virtualResourceEdits).toEqual([
      {
        resolver: "get_object_workspace_uri",
        editor: "apply_patch",
        preserveUriScheme: true
      }
    ]);
    expect(capabilities.diagnostics).toEqual(["copilot_getErrors"]);
  });

  it("distinguishes a tool-group activator from an object activation tool", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "activate_abap_object_management_tools",
        description: "Activate the ABAP object management tool group."
      },
      {
        name: "abap_activate",
        description: "Activate an ABAP object."
      }
    ]);

    expect(capabilities.toolGroupActivators).toEqual([
      "activate_abap_object_management_tools"
    ]);
    expect(capabilities.activations).toEqual(["abap_activate"]);
  });

  it("never advertises capabilities that Copilot did not supply", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "get_object_workspace_uri",
        description: "Returns a workspace URI for standard file operations."
      }
    ]);
    const instructions = buildToolCapabilityInstructions(capabilities).join("\n");

    expect(capabilities.virtualResourceEdits).toEqual([]);
    expect(capabilities.activations).toEqual([]);
    expect(instructions).toContain("No activation capability is supplied");
    expect(instructions).not.toContain("apply_patch");
  });
});
