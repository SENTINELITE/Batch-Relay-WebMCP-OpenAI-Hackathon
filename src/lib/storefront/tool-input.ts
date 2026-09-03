/**
 * Identifiers these tools accept in either casing.
 *
 * The responses speak snake_case — `draft_id`, `proposal_id`, `item_id` — while
 * the input schemas were written in camelCase. An agent doing the obvious thing,
 * copying an ID straight out of the response it just read, was rejected by the
 * schema before the handler ever saw the call, and the SDK reported only
 * "Tool requires: draftId". Nothing in that message says the value was right
 * there under a different name.
 *
 * So every ID input accepts both spellings. The camelCase name stays the
 * documented one; the snake_case twin is an alias that reads the same value.
 * Supplying both is only an error when they disagree, which is a real mistake
 * worth naming rather than a casing accident worth forgiving.
 */

function readString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The value of an ID given under either spelling, or null when absent. */
export function readIdentifierAlias(
  input: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
): string | null {
  const camelValue = readString(input, camelCase);
  const snakeValue = readString(input, snakeCase);
  if (camelValue && snakeValue && camelValue !== snakeValue) {
    throw new Error(
      `${camelCase} and ${snakeCase} are the same field and were given different values (${camelValue} and ${snakeValue}); provide exactly one.`,
    );
  }
  return camelValue ?? snakeValue;
}

/** The same, for an ID the call cannot proceed without. */
export function requireIdentifierAlias(
  input: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
  describe: string,
): string {
  const value = readIdentifierAlias(input, camelCase, snakeCase);
  if (!value) {
    throw new Error(
      `${describe} Pass it as ${camelCase} (or ${snakeCase}, the name it is returned under).`,
    );
  }
  return value;
}

/**
 * The input forwarded to the visible workbench, with each aliased ID resolved
 * to its camelCase name so only one spelling reaches the handler.
 */
export function withResolvedIdentifierAliases(
  input: Record<string, unknown>,
  aliases: readonly (readonly [camelCase: string, snakeCase: string])[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...input };
  for (const [camelCase, snakeCase] of aliases) {
    const value = readIdentifierAlias(input, camelCase, snakeCase);
    delete resolved[snakeCase];
    if (value === null) delete resolved[camelCase];
    else resolved[camelCase] = value;
  }
  return resolved;
}
