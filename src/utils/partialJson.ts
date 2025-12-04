/**
 * Tries to parse a partial JSON string into an object.
 * This is a best-effort implementation to support streaming updates.
 */
export function parsePartialJson(jsonString: string): any {
    if (!jsonString) return {};

    try {
        // First try standard parse
        return JSON.parse(jsonString);
    } catch (e) {
        // If it fails, try to "fix" the JSON string
        let fixed = jsonString;
        let stack: string[] = [];
        let inString = false;
        let isEscaped = false;

        for (let i = 0; i < fixed.length; i++) {
            const c = fixed[i];

            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                } else if (c === '\\') {
                    isEscaped = true;
                } else if (c === '"') {
                    inString = false;
                }
            } else {
                if (c === '"') {
                    inString = true;
                } else if (c === '{') {
                    stack.push('}');
                } else if (c === '[') {
                    stack.push(']');
                } else if (c === '}') {
                    if (stack.length > 0 && stack[stack.length - 1] === '}') {
                        stack.pop();
                    }
                } else if (c === ']') {
                    if (stack.length > 0 && stack[stack.length - 1] === ']') {
                        stack.pop();
                    }
                }
            }
        }

        // Fix string termination
        if (inString) {
            if (isEscaped) {
                // Remove trailing backslash to avoid escaping the closing quote
                fixed = fixed.slice(0, -1);
            }
            fixed += '"';
        }

        // Handle trailing comma or colon
        const trimmed = fixed.trimEnd();
        if (trimmed.endsWith(',')) {
            // Remove trailing comma
            const lastComma = fixed.lastIndexOf(',');
            if (lastComma !== -1 && /^\s*$/.test(fixed.substring(lastComma + 1))) {
                fixed = fixed.substring(0, lastComma);
            }
        } else if (trimmed.endsWith(':')) {
            // Append null for incomplete value
            fixed += ' null';
        }

        // Close structure
        while (stack.length > 0) {
            fixed += stack.pop();
        }

        try {
            return JSON.parse(fixed);
        } catch (e2) {
            // Fallback: Regex extraction for specific fields if JSON parsing fails completely
            // This is useful if the string is very incomplete
            const result: any = {};

            // Extract id
            const idMatch = jsonString.match(/"id"\s*:\s*"([^"]*)"/);
            if (idMatch) result.id = idMatch[1];

            // Extract title
            const titleMatch = jsonString.match(/"title"\s*:\s*"([^"]*)"/);
            if (titleMatch) result.title = titleMatch[1];

            // Extract type
            const typeMatch = jsonString.match(/"type"\s*:\s*"([^"]*)"/);
            if (typeMatch) result.type = typeMatch[1];

            // Extract content - this is hard with regex due to escaping
            // But we can try to find the start of content and take everything until the end (minus closing braces if any)
            const contentStart = jsonString.indexOf('"content"');
            if (contentStart !== -1) {
                const colonIndex = jsonString.indexOf(':', contentStart);
                if (colonIndex !== -1) {
                    const quoteStart = jsonString.indexOf('"', colonIndex + 1);
                    if (quoteStart !== -1) {
                        // let content = jsonString.substring(quoteStart + 1);
                        // If we have a closing quote that is NOT escaped, cut there
                        // But since it's partial, we might not have it.
                        // We just want the raw string content.
                        // We need to unescape it manually if we take it raw.

                        // Actually, let's just return what we have so far.
                        // It's better to rely on the "fixed" JSON if possible.
                        // If "fixed" failed, regex is risky.
                        // Let's return what we managed to parse from regex.
                    }
                }
            }

            return result;
        }
    }
}
