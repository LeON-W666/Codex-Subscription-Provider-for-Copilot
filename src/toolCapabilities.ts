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

/**
 * These are planning categories, rather than a promise that a particular
 * product exposes a tool with a particular name.  A category is populated
 * only from the tools in the current Copilot request.
 */
export const TOOL_CAPABILITY_CATEGORIES = [
  "edit/create",
  "object-management/activate",
  "execute",
  "diagnose"
] as const;

export type ToolCapabilityCategory =
  (typeof TOOL_CAPABILITY_CATEGORIES)[number];

export interface ToolCapabilityGroup {
  readonly category: ToolCapabilityCategory;
  /** Tools that can perform the category in this request. */
  readonly directTools: readonly string[];
  /** Supplied tools that can make a direct tool available in a later request. */
  readonly activators: readonly string[];
}

export interface ToolCapabilityLinks {
  readonly virtualResourceEdits: readonly VirtualResourceEditCapability[];
  readonly diagnostics: readonly string[];
  /** Direct object/resource activation tools, never group activators. */
  readonly activations: readonly string[];
  /** Kept as a flat compatibility view; use capabilityGroups for mapping. */
  readonly toolGroupActivators: readonly string[];
  /** Direct/loadable/absent capability mapping for this request. */
  readonly capabilityGroups: readonly ToolCapabilityGroup[];
}

export interface ToolActivationRetryDecision {
  readonly shouldRetry: boolean;
  readonly actionRequest: boolean;
  readonly responseClaimsUnavailable: boolean;
  readonly requestedCategories: readonly ToolCapabilityCategory[];
  readonly directTools: readonly string[];
  readonly activators: readonly string[];
}

export interface CapabilityMessageLike {
  readonly role: number;
  readonly content: readonly unknown[];
}

const URI_RESOLVER_NAME = /(?:workspace|virtual|resource).*(?:uri|url)|(?:uri|url).*(?:workspace|virtual|resource)/i;
const URI_RESOLVER_DESCRIPTION = /\b(?:workspace|virtual|resource)\s+(?:uri|url)\b/i;
const FILE_COMPATIBILITY_DESCRIPTION =
  /\b(?:standard|normal|regular|existing)\s+(?:file|editing)\s+(?:operation|operations|tool|tools)\b|\b(?:open|read|edit|patch|write).{0,80}\b(?:uri|url)\b/i;
const PATCH_EDITOR_NAME = /(?:^|_)apply_?patch(?:_|$)/i;
const EDITOR_NAME = /(?:^|_)(?:edit|replace|write|update)(?:_|$)/i;
const EDITOR_DESCRIPTION = /\b(?:apply|edit|patch|replace|write|update)\b.{0,80}\b(?:file|resource|content|text)\b/i;
const DIAGNOSTIC_NAME = /(?:^|_)(?:get_?)?(?:errors?|diagnostics?|compile|check|lint|quality_?assurance|verification|validation|analysis)(?:_|$)/i;
const DIAGNOSTIC_DESCRIPTION = /\b(?:diagnostic|compile|syntax\s+error|check\s+for\s+errors|lint|quality\s+assurance|verification|validation|analysis)\b/i;
const TOOL_GROUP_ACTIVATOR_NAME =
  /(?:activate|enable|load|expose|provide|make)_?(?:available_?)?.*(?:tool|tools|capabilit|group)|(?:tool|tools|capabilit|group).*\b(?:activate|enable|load|expose)\b/i;
const TOOL_GROUP_ACTIVATOR_DESCRIPTION =
  /\b(?:activate|enable|load|make available|expose|provide)\b.{0,120}\b(?:tool|tools|capabilit|group|operation|commands?)\b/i;
const ACTIVATION_NAME = /(?:^|_)(?:activate|activation|publish|deploy|release)(?:_|$)/i;
const ACTIVATION_DESCRIPTION =
  /\b(?:activate|publish|deploy|release)\b.{0,80}\b(?:object|resource|artifact|program|file)\b/i;

const EDIT_CREATE_OPERATION =
  /\b(?:edit|create|creation|add|new|modify|update|write|patch|replace|insert|remove|delete|rename|save|generate|generation|author|authoring)\b|(?:创建|新增|编辑|修改|更新|写入|删除|加上(?:必要的)?注释|添加(?:必要的)?注释)/i;
const OBJECT_MANAGEMENT_OPERATION =
  /\b(?:object|artifact|program|resource|entity|manage|management|transport)\b/i;
const OBJECT_MANAGEMENT_ACTION =
  /\b(?:manage|management|activate|publish|deploy|release|transport)\b/i;
const OBJECT_NOUN = /\b(?:object|artifact|program|resource|entity)\b/i;
const EXECUTE_OPERATION =
  /\b(?:execute|execution|run|invoke|launch|start|test|trigger)\b/i;

const ACTION_VERB =
  /(?:edit|create|creation|add|new|modify|update|write|patch|replace|insert|remove|delete|rename|save|generate|generation|author|authoring|activate|publish|deploy|release|manage|run|execute|invoke|launch|start|test|trigger|diagnose|diagnostic|check|compile|validate|lint|创建|新增|编辑|修改|更新|写入|删除|加上(?:必要的)?注释|添加(?:必要的)?注释|运行|执行|激活|发布|部署|诊断|检查|编译|验证)/i;
// 中文行动短语使用 Unicode 边界，避免 \b 在中文结尾处失效。
const ACTION_REQUEST =
  /^(?:please\s+|请)?(?:edit|create|add|make|modify|update|write|patch|replace|insert|remove|delete|rename|save|activate|publish|deploy|release|manage|run|execute|invoke|launch|start|test|trigger|diagnose|check|compile|validate|lint|创建|新增|编辑|修改|更新|写入|删除|加上(?:必要的)?注释并激活|添加(?:必要的)?注释并激活|运行|执行|激活|发布|部署|诊断|检查|编译|验证)(?=\s|$|[^\p{L}\p{N}_])/iu;
const DIRECTED_ACTION_REQUEST =
  /\b(?:can|could|would)\s+you\b.{0,80}(?:edit|create|add|make|modify|update|write|patch|replace|insert|remove|delete|rename|save|activate|publish|deploy|release|manage|run|execute|invoke|launch|start|test|trigger|diagnose|check|compile|validate|lint|创建|新增|编辑|修改|更新|写入|删除|加上(?:必要的)?注释并激活|添加(?:必要的)?注释并激活|运行|执行|激活|发布|部署|诊断|检查|编译|验证)(?=\s|$|[^\p{L}\p{N}_])/iu;
const NEED_ACTION_REQUEST =
  /\b(?:help\s+me|i\s+(?:need|want)\s+(?:you\s+)?to|please)\b.{0,80}(?:edit|create|add|make|modify|update|write|patch|replace|insert|remove|delete|rename|save|activate|publish|deploy|release|manage|run|execute|invoke|launch|start|test|trigger|diagnose|check|compile|validate|lint)\b/i;
const QUESTION_PREFIX =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|should|tell me|explain|describe|define|what(?:'s| is)|为什么|什么|如何|怎么|是否)/i;
const EXPLANATION_REQUEST =
  /\b(?:explain|describe|define|meaning|difference|how do i|what does|why|whether|whether or not)\b/i;
const UNAVAILABLE_CLAIM =
  /\b(?:no|not|cannot|can't|unable|unavailable|isn't|aren't|don't have|do not have|lack(?:s|ing)?)\b.{0,100}\b(?:tool|tools|capabilit|access|support|permission|available)\b|\b(?:tool|tools|capabilit|access|support)\b.{0,80}\b(?:unavailable|missing|not available|isn't available|cannot|can't)\b|(?:没有|无|无法|不能|不可用|缺少).{0,40}(?:工具|能力|权限|支持|可用)/i;

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

  const directByCategory = new Map<ToolCapabilityCategory, string[]>();
  const activatorsByCategory = new Map<ToolCapabilityCategory, string[]>();
  for (const category of TOOL_CAPABILITY_CATEGORIES) {
    directByCategory.set(category, []);
    activatorsByCategory.set(category, []);
  }

  for (const tool of suppliedTools) {
    if (activatorSet.has(tool.name)) {
      for (const category of classifyActivatorCategories(tool)) {
        activatorsByCategory.get(category)!.push(tool.name);
      }
      continue;
    }
    for (const category of classifyDirectCategories(tool)) {
      directByCategory.get(category)!.push(tool.name);
    }
  }

  const capabilityGroups = TOOL_CAPABILITY_CATEGORIES.map(category => ({
    category,
    directTools: dedupe(directByCategory.get(category) ?? []),
    activators: dedupe(activatorsByCategory.get(category) ?? [])
  }));

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
    toolGroupActivators,
    capabilityGroups
  };
}

/**
 * Decide whether one conservative, internal tool-selection correction is
 * justified.  This does not execute a tool and deliberately requires both an
 * explicit action request and an unavailable-capability claim.
 */
export function evaluateToolActivationRetry(
  messages: readonly CapabilityMessageLike[],
  userRole: number,
  capabilities: ToolCapabilityLinks,
  responseText: string
): ToolActivationRetryDecision {
  const latestUserText = latestUserRequestText(messages, userRole);
  const requestedCategories = inferRequestedCategories(latestUserText);
  const actionRequest = requestedCategories.length > 0;
  const responseClaimsUnavailable = UNAVAILABLE_CLAIM.test(responseText);
  const requestsObjectActivation =
    /\b(?:activate|publish|deploy|release)\b/i.test(latestUserText) ||
    /(?:激活|发布|部署)/i.test(latestUserText);
  const directTools = new Set<string>();
  const activators = new Set<string>();
  let missingDirectWithActivator = false;

  for (const group of capabilities.capabilityGroups) {
    if (!requestedCategories.includes(group.category)) {
      continue;
    }
    const directToolNames =
      group.category === "object-management/activate" && requestsObjectActivation
        ? capabilities.activations
        : group.directTools;
    if (directToolNames.length === 0 && group.activators.length > 0) {
      missingDirectWithActivator = true;
    }
    for (const tool of directToolNames) {
      directTools.add(tool);
    }
    for (const activator of group.activators) {
      activators.add(activator);
    }
  }

  return {
    shouldRetry:
      actionRequest &&
      responseClaimsUnavailable &&
      missingDirectWithActivator,
    actionRequest,
    responseClaimsUnavailable,
    requestedCategories,
    directTools: [...directTools],
    activators: [...activators]
  };
}

/** Backwards-friendly alias for callers that prefer a predicate-style name. */
export const shouldRetryForToolActivation = evaluateToolActivationRetry;

export function buildToolCapabilityInstructions(
  capabilities: ToolCapabilityLinks
): readonly string[] {
  const instructions: string[] = [
    "CAPABILITY_LINKS_JSON is derived only from tools Copilot supplied in this request; it is planning guidance, not permission for Codex to execute tools itself.",
    "Capability states are strict: directTools are usable now, activators are supplied loaders that may make tools available on a later Copilot request, and an empty pair means the capability was not supplied. Never turn an activator into an invented direct tool."
  ];

  for (const group of capabilities.capabilityGroups) {
    if (group.directTools.length > 0) {
      instructions.push(
        `Capability ${group.category}: direct tools supplied=${group.directTools.join(", ")}.`
      );
    } else if (group.activators.length > 0) {
      instructions.push(
        `Capability ${group.category}: no direct tool is supplied; request a matching tool-group activator first (${group.activators.join(", ")}) before saying the capability is unavailable.`
      );
    } else {
      instructions.push(
        `Capability ${group.category}: no direct tool or matching activator is supplied in this request; do not invent one or claim that Copilot performed it.`
      );
    }
  }

  const objectActivationGroup = capabilities.capabilityGroups.find(
    group => group.category === "object-management/activate"
  );
  if (objectActivationGroup !== undefined) {
    instructions.push(
      "Object-management/activate directTools may create or manage an object, but they do not prove that the object was activated. Only a tool listed in activations followed by its matching successful tool_result is evidence of object activation."
    );
    if (
      capabilities.activations.length === 0 &&
      objectActivationGroup.activators.length > 0
    ) {
      instructions.push(
        "When the user specifically requests object activation and activations is empty, request a matching object-management activator even when that capability group has create/manage directTools; wait for the next request's supplied tools before claiming activation."
      );
    }
  }

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
      "Request direct object/resource activation only after the required edits and diagnostics, and claim activation only when its matching tool_result reports success."
    );
  } else if (capabilities.toolGroupActivators.length > 0) {
    instructions.push(
      "No direct activation tool is currently supplied. If object activation is required, request a matching tool-group activator first; tool-group activation only loads tools and does not activate an ABAP or other object. Reevaluate the next request's actual tool list before requesting object activation."
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

function classifyDirectCategories(
  tool: ToolDefinitionLike
): readonly ToolCapabilityCategory[] {
  const text = toolText(tool);
  const categories = new Set<ToolCapabilityCategory>();
  if (isDiagnosticsTool(tool)) {
    categories.add("diagnose");
  }
  if (EXECUTE_OPERATION.test(text)) {
    categories.add("execute");
  }
  if (EDIT_CREATE_OPERATION.test(text)) {
    categories.add("edit/create");
  }
  if (
    isActivationTool(tool) ||
    OBJECT_MANAGEMENT_ACTION.test(text) ||
    (EDIT_CREATE_OPERATION.test(text) && OBJECT_NOUN.test(text))
  ) {
    categories.add("object-management/activate");
  }
  return [...categories];
}

function classifyActivatorCategories(
  tool: ToolDefinitionLike
): readonly ToolCapabilityCategory[] {
  const text = toolText(tool);
  const categories = new Set<ToolCapabilityCategory>();
  if (EDIT_CREATE_OPERATION.test(text)) {
    categories.add("edit/create");
  }
  if (OBJECT_MANAGEMENT_OPERATION.test(text)) {
    categories.add("object-management/activate");
  }
  if (EXECUTE_OPERATION.test(text)) {
    categories.add("execute");
  }
  if (isDiagnosticsTool(tool)) {
    categories.add("diagnose");
  }
  // Do not guess a category for a generic loader.  Without a category hint it
  // cannot be matched safely to an action request, even though it remains
  // visible through toolGroupActivators for diagnostics.
  return [...categories];
}

function latestUserRequestText(
  messages: readonly CapabilityMessageLike[],
  userRole: number
): string {
  const latest = [...messages].reverse().find(message => message.role === userRole);
  if (latest === undefined) {
    return "";
  }
  return latest.content
    .map(extractText)
    .filter((value): value is string => value !== undefined)
    .join("\n")
    .trim();
}

function extractText(part: unknown): string | undefined {
  if (!isRecord(part)) {
    return typeof part === "string" ? part : undefined;
  }
  if (typeof part.value === "string") {
    return part.value;
  }
  if (typeof part.text === "string") {
    return part.text;
  }
  return undefined;
}

function inferRequestedCategories(text: string): readonly ToolCapabilityCategory[] {
  const normalized = normalize(text);
  if (
    normalized.length === 0 ||
    !ACTION_VERB.test(normalized) ||
    isInformationalQuestion(normalized)
  ) {
    return [];
  }

  const isAction =
    ACTION_REQUEST.test(normalized) ||
    DIRECTED_ACTION_REQUEST.test(normalized) ||
    NEED_ACTION_REQUEST.test(normalized);
  if (!isAction) {
    return [];
  }

  const categories = new Set<ToolCapabilityCategory>();
  if (EDIT_CREATE_OPERATION.test(normalized)) {
    categories.add("edit/create");
  }
  if (
    /\b(?:activate|publish|deploy|release|manage|management|object|artifact|program|resource|transport)\b/i.test(normalized) ||
    /(?:激活|发布|部署|对象|资源|程序)/i.test(normalized)
  ) {
    categories.add("object-management/activate");
  }
  if (EXECUTE_OPERATION.test(normalized)) {
    categories.add("execute");
  }
  if (
    /\b(?:diagnose|diagnostic|check|compile|validate|lint|error|errors)\b/i.test(normalized) ||
    /(?:诊断|检查|编译|验证|错误)/i.test(normalized)
  ) {
    categories.add("diagnose");
  }
  return [...categories];
}

function isInformationalQuestion(text: string): boolean {
  if (DIRECTED_ACTION_REQUEST.test(text) || NEED_ACTION_REQUEST.test(text)) {
    return false;
  }
  return QUESTION_PREFIX.test(text) || EXPLANATION_REQUEST.test(text);
}

function toolText(tool: ToolDefinitionLike): string {
  return normalize(
    `${tool.name.replace(/[_-]+/g, " ")} ${tool.description}`
  );
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
