export interface ToolDefinitionLike {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: object;
}

export interface VirtualResourceEditCapability {
  readonly resolver: string;
  readonly editor: string;
  readonly preserveUriScheme: true;
}

export interface ToolCapabilityLinks {
  readonly virtualResourceEdits: readonly VirtualResourceEditCapability[];
  readonly diagnostics: readonly string[];
  readonly activations: readonly string[];
  readonly toolGroupActivators: readonly string[];
}

const URI_RESOLVER_NAME = /(?:workspace|virtual|resource).*(?:uri|url)|(?:uri|url).*(?:workspace|virtual|resource)/i;
const URI_RESOLVER_DESCRIPTION = /\b(?:workspace|virtual|resource)\s+(?:uri|url)\b/i;
const FILE_COMPATIBILITY_DESCRIPTION =
  /\b(?:standard|normal|regular|existing)\s+(?:file|editing)\s+(?:operation|operations|tool|tools)\b|\b(?:open|read|edit|patch|write).{0,80}\b(?:uri|url)\b/i;
const PATCH_EDITOR_NAME = /(?:^|_)apply_?patch(?:_|$)/i;
const EDITOR_NAME = /(?:^|_)(?:edit|replace|write|update)(?:_|$)/i;
const EDITOR_DESCRIPTION = /\b(?:apply|edit|patch|replace|write|update)\b.{0,80}\b(?:file|resource|content|text)\b/i;
const DIAGNOSTIC_NAME = /(?:^|_)(?:get_?)?(?:errors?|diagnostics?|compile|check)(?:_|$)/i;
const DIAGNOSTIC_DESCRIPTION = /\b(?:diagnostic|compile|syntax\s+error|check\s+for\s+errors)\b/i;
const TOOL_GROUP_ACTIVATOR_NAME =
  /(?:activate|enable).*(?:tool|tools|capabilit|group)|(?:tool|tools).*(?:activate|enable)/i;
const TOOL_GROUP_ACTIVATOR_DESCRIPTION =
  /\b(?:activate|enable|load|make available)\b.{0,80}\b(?:tool|tools|capabilit|group)\b/i;
const ACTIVATION_NAME = /(?:^|_)(?:activate|activation|publish|deploy)(?:_|$)/i;
const ACTIVATION_DESCRIPTION =
  /\b(?:activate|publish|deploy)\b.{0,80}\b(?:object|resource|artifact|program|file)\b/i;

export function resolveToolCapabilities(
  tools: readonly ToolDefinitionLike[] | undefined
): ToolCapabilityLinks {
  const suppliedTools = tools ?? [];
  const resolvers = suppliedTools.filter(isVirtualResourceResolver);
  const editors = suppliedTools.filter(isEditor);
  const toolGroupActivators = suppliedTools
    .filter(isToolGroupActivator)
    .map(tool => tool.name);
  const activatorSet = new Set(toolGroupActivators);

  return {
    virtualResourceEdits: resolvers.flatMap(resolver =>
      editors.map(editor => ({
        resolver: resolver.name,
        editor: editor.name,
        preserveUriScheme: true as const
      }))
    ),
    diagnostics: suppliedTools.filter(isDiagnosticsTool).map(tool => tool.name),
    activations: suppliedTools
      .filter(tool => !activatorSet.has(tool.name) && isActivationTool(tool))
      .map(tool => tool.name),
    toolGroupActivators
  };
}

export function buildToolCapabilityInstructions(
  capabilities: ToolCapabilityLinks
): readonly string[] {
  const instructions: string[] = [
    "CAPABILITY_LINKS_JSON is derived only from tools Copilot supplied in this request; it is planning guidance, not permission for Codex to execute tools itself."
  ];

  if (capabilities.virtualResourceEdits.length > 0) {
    instructions.push(
      "For each virtualResourceEdits link, first request its resolver, then use the returned workspace or virtual URI unchanged in the linked editor call.",
      "A resolver-returned URI may use a non-file scheme such as adt://. When the resolver declares compatibility with file or editing operations, that URI satisfies the linked editor's path requirement even if the editor description uses local-path wording.",
      "Never translate a virtual URI into a local filesystem path. Copilot remains responsible for executing the resolver and editor calls."
    );
  }

  if (capabilities.diagnostics.length > 0) {
    instructions.push(
      "After a successful edit, request a supplied diagnostics tool when the task requires validation. Treat its tool_result, not the prior tool_call, as evidence."
    );
  }

  if (capabilities.activations.length > 0) {
    instructions.push(
      "Request activation only after the required edits and diagnostics, and claim activation only when its matching tool_result reports success."
    );
  } else if (capabilities.toolGroupActivators.length > 0) {
    instructions.push(
      "No direct activation tool is currently supplied. If activation is required, a supplied tool-group activator may be requested; reevaluate the next request's actual tool list before requesting activation."
    );
  } else {
    instructions.push(
      "No activation capability is supplied in this request. Do not invent one or claim activation; complete the supported work and state the unverified activation status precisely."
    );
  }

  return instructions;
}

function isVirtualResourceResolver(tool: ToolDefinitionLike): boolean {
  const description = normalize(tool.description);
  const describesUri = URI_RESOLVER_DESCRIPTION.test(description);
  const describesFileCompatibility = FILE_COMPATIBILITY_DESCRIPTION.test(description);
  return URI_RESOLVER_NAME.test(tool.name) && (describesUri || describesFileCompatibility);
}

function isEditor(tool: ToolDefinitionLike): boolean {
  if (PATCH_EDITOR_NAME.test(tool.name)) {
    return true;
  }
  return EDITOR_NAME.test(tool.name) &&
    EDITOR_DESCRIPTION.test(normalize(tool.description));
}

function isDiagnosticsTool(tool: ToolDefinitionLike): boolean {
  return DIAGNOSTIC_NAME.test(tool.name) ||
    DIAGNOSTIC_DESCRIPTION.test(normalize(tool.description));
}

function isToolGroupActivator(tool: ToolDefinitionLike): boolean {
  return TOOL_GROUP_ACTIVATOR_NAME.test(tool.name) ||
    TOOL_GROUP_ACTIVATOR_DESCRIPTION.test(normalize(tool.description));
}

function isActivationTool(tool: ToolDefinitionLike): boolean {
  return ACTIVATION_NAME.test(tool.name) ||
    ACTIVATION_DESCRIPTION.test(normalize(tool.description));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
