/**
 * RichReviewEditor — controlled tiptap WYSIWYG for a single rich-text review
 * answer. The toolbar exposes ONLY the formatting in the server sanitizer's
 * allowlist (lib/external/sanitize-review-html.js): bold, italic, bullet +
 * numbered lists, H2/H3, blockquote, links. No images, no tables, no code.
 *
 * The editor is convenience, NOT the security boundary — every answer is
 * server-sanitized on autosave (draft PUT) and submit, and re-sanitized before
 * staff render. Matching the toolbar to the allowlist just keeps WYSIWYG honest
 * (what you format is what survives).
 *
 * Controlled: `value` is HTML in, `onChange(html)` fires on edits. External
 * value changes (e.g. a draft load) are synced in without clobbering the
 * caret during local typing.
 */

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

// StarterKit ships marks/nodes beyond our allowlist (code, codeBlock, strike,
// horizontalRule). Disable them so the editor can't produce formatting the
// sanitizer would strip, and pin headings to H2/H3.
const STARTER_KIT_CONFIG = {
  heading: { levels: [2, 3] },
  code: false,
  codeBlock: false,
  strike: false,
  horizontalRule: false,
};

const LINK_CONFIG = {
  openOnClick: false,
  autolink: true,
  protocols: ['https', 'mailto'],
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
};

function ToolbarButton({ onClick, active, disabled, label, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={!!active}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`px-2 py-1 text-sm rounded border ${
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export default function RichReviewEditor({ value = '', onChange, disabled = false, ariaLabel }) {
  const editor = useEditor({
    extensions: [StarterKit.configure(STARTER_KIT_CONFIG), Link.configure(LINK_CONFIG)],
    content: value || '',
    editable: !disabled,
    // Next.js SSR: defer first render to the client to avoid hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[8rem] px-3 py-2 focus:outline-none',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (onChange) onChange(ed.getHTML());
    },
  });

  // Sync external value → editor only when it diverges (e.g. async draft load).
  // Guard against echoing our own onUpdate back in (which would reset the caret).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current && (value || '') !== current) {
      editor.commands.setContent(value || '', false);
    }
  }, [value, editor]);

  // Reflect disabled changes.
  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className="border border-gray-300 rounded-lg">
        <div className="min-h-[8rem] px-3 py-2 text-sm text-gray-400">Loading editor…</div>
      </div>
    );
  }

  const setLink = () => {
    const prev = editor.getAttributes('link').href || '';
    const url = typeof window !== 'undefined' ? window.prompt('Link URL (https:// or mailto:)', prev) : null;
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-gray-900">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 p-2 bg-gray-50 rounded-t-lg">
        <ToolbarButton label="Bold" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
        <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
        <ToolbarButton label="Bulleted list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
        <ToolbarButton label="Quote" active={editor.isActive('blockquote')} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive('link')} disabled={disabled} onClick={setLink}>🔗</ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
