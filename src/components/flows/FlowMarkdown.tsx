import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Entry descriptions: limited Markdown (docs/plans/flow-leaderboard.md §6.5). No links, images or
 * raw HTML: anything else is unwrapped to its text. Used by the detail page and the submit
 * dialog's preview, so the submitter sees exactly what others will.
 */
const ALLOWED_ELEMENTS = ["p", "em", "strong", "ul", "ol", "li", "code", "pre", "h3", "blockquote", "br"];

export const FlowMarkdown: React.FC<{ text: string; className?: string }> = ({ text, className = "" }) => (
  <div
    className={`text-sm text-slate-300 leading-relaxed break-words space-y-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-100 [&_h3]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:bg-slate-900/70 [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:bg-slate-900/70 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_blockquote]:border-l-2 [&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_strong]:text-slate-100 ${className}`}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={ALLOWED_ELEMENTS} unwrapDisallowed skipHtml>
      {text}
    </ReactMarkdown>
  </div>
);
