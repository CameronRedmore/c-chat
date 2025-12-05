import type { Artifact } from '../stores/chat';

/**
 * Resolves relative links in HTML content to Blob URLs pointing to the corresponding artifacts.
 * 
 * @param html The HTML content to process
 * @param basePath The base path of the current artifact (e.g., "dist/index.html" -> "dist/")
 * @param sessionArtifacts All artifacts in the current session
 * @returns An object containing the processed HTML and a cleanup function to revoke Blob URLs
 */
export function resolveArtifactLinks(html: string, basePath: string, sessionArtifacts: Artifact[]) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const createdUrls: string[] = [];

    // Helper to resolve path
    // Helper to resolve path
    const resolvePath = (relativePath: string) => {
        // Determine base directory from the current artifact path
        // e.g. "index.html" -> [], "pages/about.html" -> ["pages"]
        const baseParts = basePath.split('/').filter(p => p);
        if (baseParts.length > 0 && !basePath.endsWith('/')) {
            // If it looks like a file path (doesn't end in /), pop the filename
            baseParts.pop();
        }

        // simple path resolution
        // remove ./
        let cleanRel = relativePath.startsWith('./') ? relativePath.slice(2) : relativePath;

        // handle ../ (very basic support)
        const relParts = cleanRel.split('/');

        while (relParts[0] === '..') {
            if (baseParts.length > 0) {
                baseParts.pop();
            }
            relParts.shift();
        }

        return [...baseParts, ...relParts].join('/');
    };

    const processAttribute = (element: Element, attr: string) => {
        const value = element.getAttribute(attr);
        if (!value) return;

        // Skip absolute URLs, data URIs, etc.
        if (value.startsWith('http') || value.startsWith('//') || value.startsWith('data:') || value.startsWith('#')) {
            return;
        }

        const resolvedPath = resolvePath(value);
        const artifact = sessionArtifacts.find(a => a.path === resolvedPath || a.path === '/' + resolvedPath);

        if (artifact) {
            const blob = new Blob([artifact.content], { type: artifact.type });
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            element.setAttribute(attr, url);
        }
    };

    // Process links (css)
    doc.querySelectorAll('link[href]').forEach(el => processAttribute(el, 'href'));

    // Process scripts (js)
    doc.querySelectorAll('script[src]').forEach(el => processAttribute(el, 'src'));

    // Process images
    doc.querySelectorAll('img[src]').forEach(el => processAttribute(el, 'src'));

    // Process anchors? Maybe not, usually we want to stay in the app or open external.
    // But if it links to another artifact html page, we might want to handle it?
    // For now let's stick to resources.

    return {
        html: doc.documentElement.outerHTML,
        cleanup: () => {
            createdUrls.forEach(url => URL.revokeObjectURL(url));
        }
    };
}
