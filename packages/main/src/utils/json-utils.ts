/**
 * JSON utilities.
 */

/**
 * Safely parse JSON with a fallback value
 */
export function safeJSONParse<T>(jsonString: string, fallback: T): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return fallback;
  }
}

/**
 * Clean a JSON string by removing common issues
 */
export function cleanJSON(jsonString: string): string {
  return (
    jsonString
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
      .trim()
  );
}

/**
 * Combined clean and parse
 */
export function cleanAndParseJSON<T>(jsonString: string, fallback: T): T {
  return safeJSONParse(cleanJSON(jsonString), fallback);
}

/**
 * Stringify with pretty printing
 */
export function prettyJSON(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent);
}
