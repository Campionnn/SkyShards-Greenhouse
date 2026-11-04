import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../ui/cn";

/**
 * Entry descriptions: limited Markdown (docs/plans/flow-leaderboard.md §6.5). No links, images or
 * raw HTML: anything else is unwrapped to its text. Used by the detail page and the submit
 * dialog's preview, so the submitter sees exactly what others will.
 */
const ALLOWED_ELEMENTS = ["p", "em", "strong", "ul", "ol", "li", "code", "pre", "h3", "blockquote", "br"];

export const FlowMarkdown: React.FC<{ text: string; className?: string }> = ({ text, className = "" }) => (
  <div
    className={cn(
      "max-w-[72ch] space-y-2 break-words text-body text-fg-body",
      "[&_h3]:mt-3 [&_h3]:text-body [&_h3]:font-semibold [&_h3]:text-fg [&_strong]:font-semibold [&_strong]:text-fg",
      "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
      "[&_code]:rounded-inner [&_code]:bg-surface-well [&_code]:px-1 [&_code]:font-mono [&_code]:text-secondary",
      "[&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-control [&_pre]:bg-surface-well [&_pre]:p-2",
      "[&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-fg-muted",
      className,
    )}
  >
    <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={ALLOWED_ELEMENTS} unwrapDisallowed skipHtml>
      {text}
    </ReactMarkdown>
  </div>
);
