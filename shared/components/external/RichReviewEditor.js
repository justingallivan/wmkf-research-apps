/**
 * RichReviewEditor — controlled tiptap WYSIWYG for a single rich-text review
 * answer. The external reviewer portal uses the same compact scientific-text
 * toolbar as the grantee abstract/caption editor: bold, italic, subscript,
 * superscript, undo, and redo. The staff rescue form retains the original full
 * toolbar for backward-compatible manual entry. Both modes emit HTML from the
 * same schema and remain bounded by the server sanitizer allowlist.
 *
 * The editor is convenience, NOT the security boundary — every answer is
 * server-sanitized on autosave (draft PUT) and submit, and re-sanitized before
 * staff render. Every exposed control maps to a sanitizer-preserved tag; the
 * wider structural allowlist exists only for historical/staff compatibility.
 *
 * Controlled: `value` is HTML in, `onChange(html)` fires on edits. External
 * value changes (e.g. a draft load) are synced in without clobbering the
 * caret during local typing.
 */

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';

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

const ExclusiveSubscript = Subscript.extend({ excludes: 'superscript' });
const ExclusiveSuperscript = Superscript.extend({ excludes: 'subscript' });

export const RICH_REVIEW_EXTENSIONS = [
  StarterKit.configure(STARTER_KIT_CONFIG),
  Link.configure(LINK_CONFIG),
  ExclusiveSubscript,
  ExclusiveSuperscript,
];

function ToolbarButton({ onClick, active, disabled, label, children }) {
  const pressed = typeof active === 'boolean' ? { 'aria-pressed': active } : {};
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`px-2 py-1 text-sm rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
      } disabled:opacity-40`}
      {...pressed}
    >
      {children}
    </button>
  );
}

export default function RichReviewEditor({
  value = '',
  onChange,
  disabled = false,
  ariaLabel,
  toolbarLabel = 'Review formatting',
  toolbarVariant = 'compact',
}) {
  const editor = useEditor({
    extensions: RICH_REVIEW_EXTENSIONS,
    content: value || '',
    editable: !disabled,
    // Next.js SSR: defer first render to the client to avoid hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[8rem] px-3 py-2 focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
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
  const toggleSubscript = () => editor.chain().focus().unsetSuperscript().toggleSubscript().run();
  const toggleSuperscript = () => editor.chain().focus().unsetSubscript().toggleSuperscript().run();
  // Only an explicit full variant exposes the structural controls. An invalid
  // value must fail closed to the smaller reviewer-facing toolbar.
  const compactToolbar = toolbarVariant !== 'full';

  return (
    <div className="border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-gray-900">
      <div role="toolbar" aria-label={toolbarLabel} className="flex flex-wrap gap-1 border-b border-gray-200 p-2 bg-gray-50 rounded-t-lg">
        <ToolbarButton label="Bold" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        {compactToolbar ? (
          <>
            <ToolbarButton label="Subscript" active={editor.isActive('subscript')} disabled={disabled} onClick={toggleSubscript}>X₂</ToolbarButton>
            <ToolbarButton label="Superscript" active={editor.isActive('superscript')} disabled={disabled} onClick={toggleSuperscript}>X²</ToolbarButton>
            <ToolbarButton label="Undo" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>Undo</ToolbarButton>
            <ToolbarButton label="Redo" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>Redo</ToolbarButton>
          </>
        ) : (
          <>
            <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
            <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
            <ToolbarButton label="Bulleted list" active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</ToolbarButton>
            <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
            <ToolbarButton label="Quote" active={editor.isActive('blockquote')} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolbarButton>
            <ToolbarButton label="Link" active={editor.isActive('link')} disabled={disabled} onClick={setLink}>🔗</ToolbarButton>
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
