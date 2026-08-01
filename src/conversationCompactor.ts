export interface CompactableMessage {
  readonly role: number;
  readonly content: readonly unknown[];
}

export interface ConversationCompactionResult<TMessage extends CompactableMessage> {
  readonly messages: readonly TMessage[];
  readonly applied: boolean;
  readonly tokenBudget: number;
  readonly originalTokenEstimate: number;
  readonly retainedTokenEstimate: number;
  readonly omittedMessageCount: number;
  readonly overBudget: boolean;
}

interface MessageGroup {
  readonly indices: readonly number[];
  readonly newestIndex: number;
  readonly tokenEstimate: number;
}

export function compactConversation<TMessage extends CompactableMessage>(
  messages: readonly TMessage[],
  userRole: number,
  tokenBudget: number,
  estimateMessageTokens: (message: TMessage) => number
): ConversationCompactionResult<TMessage> {
  const boundedBudget = Math.max(1, Math.trunc(tokenBudget));
  const messageTokens = messages.map(message => Math.max(1, estimateMessageTokens(message)));
  const originalTokenEstimate = sum(messageTokens);

  if (originalTokenEstimate <= boundedBudget || messages.length <= 1) {
    return {
      messages,
      applied: false,
      tokenBudget: boundedBudget,
      originalTokenEstimate,
      retainedTokenEstimate: originalTokenEstimate,
      omittedMessageCount: 0,
      overBudget: originalTokenEstimate > boundedBudget
    };
  }

  const groups = buildMessageGroups(messages, messageTokens);
  const groupByMessageIndex = new Map<number, MessageGroup>();
  for (const group of groups) {
    for (const index of group.indices) {
      groupByMessageIndex.set(index, group);
    }
  }

  const forcedGroups = new Set<MessageGroup>();
  const latestMessageGroup = groupByMessageIndex.get(messages.length - 1);
  if (latestMessageGroup !== undefined) {
    forcedGroups.add(latestMessageGroup);
  }
  const instructionIndex = findLatestUserInstructionIndex(messages, userRole);
  if (instructionIndex !== undefined) {
    const instructionGroup = groupByMessageIndex.get(instructionIndex);
    if (instructionGroup !== undefined) {
      forcedGroups.add(instructionGroup);
    }
  }

  const selectedGroups = new Set<MessageGroup>(forcedGroups);
  let retainedTokenEstimate = sum(
    [...selectedGroups].map(group => group.tokenEstimate)
  );

  for (const group of [...groups].sort((left, right) => right.newestIndex - left.newestIndex)) {
    if (selectedGroups.has(group)) {
      continue;
    }
    if (retainedTokenEstimate + group.tokenEstimate > boundedBudget) {
      continue;
    }
    selectedGroups.add(group);
    retainedTokenEstimate += group.tokenEstimate;
  }

  const selectedIndices = new Set(
    [...selectedGroups].flatMap(group => [...group.indices])
  );
  const retainedMessages = messages.filter((_, index) => selectedIndices.has(index));

  return {
    messages: retainedMessages,
    applied: retainedMessages.length !== messages.length,
    tokenBudget: boundedBudget,
    originalTokenEstimate,
    retainedTokenEstimate,
    omittedMessageCount: messages.length - retainedMessages.length,
    overBudget: retainedTokenEstimate > boundedBudget
  };
}

function buildMessageGroups<TMessage extends CompactableMessage>(
  messages: readonly TMessage[],
  messageTokens: readonly number[]
): readonly MessageGroup[] {
  const parents = messages.map((_, index) => index);
  const firstMessageForCallId = new Map<string, number>();

  for (const [messageIndex, message] of messages.entries()) {
    for (const callId of collectCallIds(message)) {
      const priorIndex = firstMessageForCallId.get(callId);
      if (priorIndex === undefined) {
        firstMessageForCallId.set(callId, messageIndex);
      } else {
        union(parents, messageIndex, priorIndex);
      }
    }
  }

  const indicesByRoot = new Map<number, number[]>();
  for (const index of messages.keys()) {
    const root = find(parents, index);
    const indices = indicesByRoot.get(root) ?? [];
    indices.push(index);
    indicesByRoot.set(root, indices);
  }

  return [...indicesByRoot.values()].map(indices => ({
    indices,
    newestIndex: Math.max(...indices),
    tokenEstimate: sum(indices.map(index => messageTokens[index] ?? 1))
  }));
}

function collectCallIds(message: CompactableMessage): readonly string[] {
  const callIds = new Set<string>();
  for (const part of message.content) {
    if (isRecord(part) && typeof part.callId === "string") {
      callIds.add(part.callId);
    }
  }
  return [...callIds];
}

function findLatestUserInstructionIndex<TMessage extends CompactableMessage>(
  messages: readonly TMessage[],
  userRole: number
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === userRole && isUserInstruction(message)) {
      return index;
    }
  }
  return undefined;
}

function isUserInstruction(message: CompactableMessage): boolean {
  return message.content.some(part =>
    isRecord(part) &&
    typeof part.value === "string" &&
    !("callId" in part)
  );
}

function find(parents: number[], index: number): number {
  const parent = parents[index] ?? index;
  if (parent === index) {
    return index;
  }
  const root = find(parents, parent);
  parents[index] = root;
  return root;
}

function union(parents: number[], left: number, right: number): void {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
