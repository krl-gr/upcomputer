/**
 * Every enum in a tool's input schema that Gemini rejects, as `tool.path.enum [values]`.
 * Gemini fails the whole request when an enum holds anything but non-empty strings.
 */
export const enumsGeminiRejects = (toolName: string, schema: unknown) => {
  const rejected: Array<string> = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "enum" &&
        Array.isArray(value) &&
        (value.length === 0 || value.some((item) => typeof item !== "string" || item === ""))
      ) {
        rejected.push(`${toolName}${path}.enum ${JSON.stringify(value)}`);
      } else visit(value, `${path}.${key}`);
    }
  };
  visit(schema, "");
  return rejected;
};
