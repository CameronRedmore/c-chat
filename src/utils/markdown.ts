import MarkdownIt from 'markdown-it';
// @ts-ignore
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

md.options.highlight = function (str, lang) {
  const code = (lang && hljs.getLanguage(lang))
    ? hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
    : md.utils.escapeHtml(str);

  return `<div class="relative group my-4 rounded-lg overflow-hidden bg-gray-900 border border-gray-700">
    <div class="flex justify-between items-center bg-gray-800 px-4 py-1.5 border-b border-gray-700 text-xs text-gray-400 select-none">
      <span class="font-mono">${lang || 'text'}</span>
      <button class="copy-code-btn flex items-center gap-1.5 hover:text-white transition-colors" title="Copy code">
        <span class="text-lg">📋</span>
        <span>Copy</span>
      </button>
    </div>
    <pre class="!m-0 !p-4 !bg-transparent overflow-x-auto"><code class="hljs ${lang ? 'language-' + lang : ''}">${code}</code></pre>
  </div>`;
};

// Define custom rule to allow spaces in inline math
texmath.rules.custom_dollars = {
  inline: [
    {
      name: 'math_inline_double',
      rex: /\${2}([^$]*?[^\\])\${2}/gy,
      tmpl: '<section><eqn>$1</eqn></section>',
      tag: '$$',
      displayMode: true
    },
    {
      name: 'math_inline',
      rex: /\$((?:[^$\\]|\\.)+?)\$/gy,
      tmpl: '<eq>$1</eq>',
      tag: '$'
    }
  ],
  block: [
    {
      name: 'math_block_eqno',
      rex: /\${2}([^$]*?[^\\])\${2}\s*?\(([^)\s]+?)\)/gmy,
      tmpl: '<section class="eqno"><eqn>$1</eqn><span>($2)</span></section>',
      tag: '$$'
    },
    {
      name: 'math_block',
      rex: /\${2}([^$]*?[^\\])\${2}/gmy,
      tmpl: '<section><eqn>$1</eqn></section>',
      tag: '$$'
    }
  ]
};

md.use(texmath, {
  engine: katex,
  delimiters: ['custom_dollars', 'brackets'],
  katexOptions: { macros: { "\\RR": "\\mathbb{R}" } }
});

export const renderMarkdown = (text: string): string => {
  const rawHtml = md.render(text || '');
  return DOMPurify.sanitize(rawHtml);
  // return rawHtml;
};

export default md;
