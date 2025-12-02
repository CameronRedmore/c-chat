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
  if (lang && hljs.getLanguage(lang)) {
    try {
      return '<pre><code class="hljs">' +
        hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
        '</code></pre>';
    } catch (__) { }
  }

  return '<pre><code class="hljs">' + md.utils.escapeHtml(str) + '</code></pre>';
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
