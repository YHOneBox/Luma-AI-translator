import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function openExternal(href) {
  if (!href) return;
  window.electronAPI?.openDictionary?.(href);
}

export default function MarkdownContent({ children, className = '' }) {
  const text = String(children || '');
  if (!text.trim()) return null;

  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children: linkChildren }) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(href);
                }}
              >
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
