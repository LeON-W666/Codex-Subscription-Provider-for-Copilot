import { describe, expect, it } from "vitest";
import {
  buildToolCapabilityInstructions,
  evaluateToolActivationRetry,
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

  it("recognizes observed ABAP tool-group names by operation category", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "activate_abap_analysis_and_creation_tools",
        description: "Activate ABAP analysis and creation tools."
      },
      {
        name: "activate_abap_object_management_tools",
        description: "Activate ABAP object management tools."
      },
      {
        name: "activate_abap_command_execution_tools",
        description: "Activate ABAP command execution tools."
      },
      {
        name: "activate_abap_quality_assurance_tools",
        description: "Activate ABAP quality assurance tools."
      }
    ]);

    const group = (category: string) =>
      capabilities.capabilityGroups.find(item => item.category === category);
    expect(group("edit/create")?.activators).toContain(
      "activate_abap_analysis_and_creation_tools"
    );
    expect(group("object-management/activate")?.activators).toContain(
      "activate_abap_object_management_tools"
    );
    expect(group("execute")?.activators).toContain(
      "activate_abap_command_execution_tools"
    );
    expect(group("diagnose")?.activators).toContain(
      "activate_abap_quality_assurance_tools"
    );
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

  it("maps only supplied tools into direct and loadable capability states", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "create_program",
        description: "Create or edit a program resource."
      },
      {
        name: "manage_object",
        description: "Manage an object."
      },
      {
        name: "execute_program",
        description: "Execute a program."
      },
      {
        name: "get_diagnostics",
        description: "Return diagnostics for a resource."
      },
      {
        name: "enable_diagnostics_tools",
        description: "Enable the diagnostics tool group."
      }
    ]);

    expect(capabilities.capabilityGroups).toEqual([
      {
        category: "edit/create",
        directTools: ["create_program"],
        activators: []
      },
      {
        category: "object-management/activate",
        directTools: ["create_program", "manage_object"],
        activators: []
      },
      {
        category: "execute",
        directTools: ["execute_program"],
        activators: []
      },
      {
        category: "diagnose",
        directTools: ["get_diagnostics"],
        activators: ["enable_diagnostics_tools"]
      }
    ]);

    const instructions = buildToolCapabilityInstructions(capabilities).join("\n");
    expect(instructions).toContain("directTools are usable now");
    expect(instructions).toContain("activators are supplied loaders");
    expect(
      buildToolCapabilityInstructions(
        resolveToolCapabilities([{ name: "read_resource", description: "Read a resource." }])
      ).join("\n")
    ).toContain("no direct tool or matching activator");
  });

  it("requests a matching activator only for an explicit action and unavailable claim", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "activate_object_management_tools",
        description: "Activate the object management tool group."
      }
    ]);

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "Please activate this object." }] }],
        1,
        capabilities,
        "I cannot do that because no activation tool is available."
      )
    ).toMatchObject({
      shouldRetry: true,
      requestedCategories: ["object-management/activate"],
      activators: ["activate_object_management_tools"]
    });

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "What does object activation mean?" }] }],
        1,
        capabilities,
        "No activation tool is available."
      ).shouldRetry
    ).toBe(false);
  });

  it("does not treat an object-management tool as direct object activation", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "create_object",
        description: "Create an object."
      },
      {
        name: "enable_object_management_tools",
        description: "Enable the object management tool group."
      }
    ]);

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "Activate the object." }] }],
        1,
        capabilities,
        "The activation tool is unavailable."
      ).shouldRetry
    ).toBe(true);
  });

  it("still activates recovery when another requested category has direct tools", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "create_object",
        description: "Create an object."
      },
      {
        name: "activate_object_management_tools",
        description: "Activate the object management tool group."
      }
    ]);

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "加上必要的注释并激活" }] }],
        1,
        capabilities,
        "No activation tool is available."
      ).shouldRetry
    ).toBe(true);
  });

  it("recognizes a Chinese edit-and-activate action without treating a question as one", () => {
    const capabilities = resolveToolCapabilities([
      {
        name: "activate_object_management_tools",
        description: "Activate the object management tool group."
      }
    ]);

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "加上必要的注释并激活" }] }],
        1,
        capabilities,
        "没有可用的工具来完成该操作。"
      )
    ).toMatchObject({
      shouldRetry: true,
      requestedCategories: ["edit/create", "object-management/activate"]
    });

    expect(
      evaluateToolActivationRetry(
        [{ role: 1, content: [{ value: "什么是激活工具？" }] }],
        1,
        capabilities,
        "没有可用的工具。"
      ).shouldRetry
    ).toBe(false);
  });
});
