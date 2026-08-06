import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  markdown: string;
};

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export default function Markdown({ markdown }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children, ...props }) => (
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" {...props}>
            {children}
          </h1>
        ),
        h2: ({ children, ...props }) => (
          <h2 className="mt-10 text-2xl font-semibold tracking-tight" {...props}>
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 className="mt-8 text-xl font-semibold tracking-tight" {...props}>
            {children}
          </h3>
        ),
        p: ({ children, ...props }) => (
          <p className="mt-4 text-[15.5px] leading-7 text-neutral-800" {...props}>
            {children}
          </p>
        ),
        ul: ({ children, ...props }) => (
          <ul className="mt-4 list-disc pl-6 space-y-2 text-[15.5px] leading-7 text-neutral-800" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="mt-4 list-decimal pl-6 space-y-2 text-[15.5px] leading-7 text-neutral-800" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="pl-1" {...props}>
            {children}
          </li>
        ),
        a: ({ href, children, ...props }) => {
          const url = String(href || "");
          if (!url) return <span {...props}>{children}</span>;

          if (isExternal(url)) {
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF8D21] hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          }

          return (
            <Link href={url} className="text-[#FF8D21] hover:underline" {...(props as any)}>
              {children}
            </Link>
          );
        },
        code: ({ children, ...props }) => (
          <code
            className="rounded bg-neutral-100 px-1.5 py-0.5 text-[13px] text-neutral-900"
            {...props}
          >
            {children}
          </code>
        ),
        pre: ({ children, ...props }) => (
          <pre
            className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-[13px] leading-6"
            {...props}
          >
            {children}
          </pre>
        ),
        blockquote: ({ children, ...props }) => (
          <blockquote
            className="mt-4 border-l-4 border-neutral-200 pl-4 text-neutral-700"
            {...props}
          >
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
