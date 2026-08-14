/**
 * GranteeAbstractEditor — restricted Markdown-backed Tiptap editor for award
 * abstracts. Parent forms keep canonical Markdown; `htmlValue` is a derived,
 * sanitized load value and is never persisted.
 */

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import { MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH } from '../../config/granteeAbstract';
import {
  sanitizeGranteeAbstractPasteHtml,
  serializeGranteeAbstractMarkdown,
} from '../../utils/grantee-markdown-serializer';

const STARTER_KIT_CONFIG = {
  blockquote: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  heading: false,
  horizontalRule: false,
  listItem: false,
  orderedList: false,
  strike: false,
};

const ExclusiveSubscript = Subscript.extend({ excludes: 'superscript' });
const ExclusiveSuperscript = Superscript.extend({ excludes: 'subscript' });

export const GRANTEE_ABSTRACT_EXTENSIONS = [
  StarterKit.configure(STARTER_KIT_CONFIG),
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
      onMouseDown={(event) => event.preventDefault()}
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

function insertExternalDrop(view, event) {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  const html = transfer.getData('text/html');
  const plain = transfer.getData('text/plain');
  if (!html && !plain) return false;

  const container = document.createElement('div');
  container.innerHTML = html
    ? sanitizeGranteeAbstractPasteHtml(html)
    : `<p>${String(plain).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))}</p>`;
  const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, { preserveWhitespace: true });
  let coordinates = null;
  try {
    coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
  } catch {
    // Non-layout environments cannot resolve screen coordinates. Insertion at
    // the current selection still preserves the complete dropped document.
  }
  const position = coordinates?.pos ?? view.state.selection.from;
  view.dispatch(view.state.tr.replaceWith(position, position, slice.content).scrollIntoView());
  event.preventDefault();
  return true;
}

export default function GranteeAbstractEditor({
  value = '',
  htmlValue = '',
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  required = false,
  invalid = false,
  describedBy,
  maxLength = MAX_GRANTEE_ABSTRACT_MARKDOWN_LENGTH,
}) {
  const lastExternalValue = useRef(value);
  const lastEmittedValue = useRef(null);

  const editor = useEditor({
    extensions: GRANTEE_ABSTRACT_EXTENSIONS,
    content: htmlValue || '<p></p>',
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[10rem] px-3 py-2 focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        'aria-required': String(required),
        'aria-invalid': String(invalid),
        'aria-readonly': String(disabled),
      },
      transformPastedHTML: sanitizeGranteeAbstractPasteHtml,
      handleDrop: (view, event, _slice, moved) => (moved ? false : insertExternalDrop(view, event)),
    },
    onUpdate: ({ editor: currentEditor }) => {
      const markdown = serializeGranteeAbstractMarkdown(currentEditor.state.doc);
      lastEmittedValue.current = markdown;
      if (onChange) onChange(markdown);
    },
  });

  // Parent echo after onChange must not reset the caret. A genuinely new server
  // value reseeds from its separately derived safe HTML without emitting update.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedValue.current) {
      lastExternalValue.current = value;
      return;
    }
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    editor.commands.setContent(htmlValue || '<p></p>', false);
  }, [editor, htmlValue, value]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled, false);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div className="border border-gray-300 rounded-lg">
        <div className="min-h-[10rem] px-3 py-2 text-sm text-gray-400">Loading editor…</div>
      </div>
    );
  }

  const remaining = maxLength - value.length;
  const overLimit = remaining < 0;
  const toggleSubscript = () => editor.chain().focus().unsetSuperscript().toggleSubscript().run();
  const toggleSuperscript = () => editor.chain().focus().unsetSubscript().toggleSuperscript().run();

  return (
    <div>
      <div className="border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-gray-900">
        <div role="toolbar" aria-label="Abstract formatting" className="flex flex-wrap gap-1 border-b border-gray-200 p-2 bg-gray-50 rounded-t-lg">
          <ToolbarButton label="Bold" active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
          <ToolbarButton label="Italic" active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
          <ToolbarButton label="Subscript" active={editor.isActive('subscript')} disabled={disabled} onClick={toggleSubscript}>X₂</ToolbarButton>
          <ToolbarButton label="Superscript" active={editor.isActive('superscript')} disabled={disabled} onClick={toggleSuperscript}>X²</ToolbarButton>
          <ToolbarButton label="Undo" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>Undo</ToolbarButton>
          <ToolbarButton label="Redo" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>Redo</ToolbarButton>
        </div>
        <EditorContent editor={editor} />
      </div>
      <p className={`mt-1 text-xs ${overLimit ? 'text-red-700' : 'text-gray-500'}`} role={overLimit ? 'alert' : undefined}>
        {overLimit
          ? `${Math.abs(remaining).toLocaleString()} characters over the ${maxLength.toLocaleString()} character limit.`
          : `${remaining.toLocaleString()} characters remaining.`}
      </p>
    </div>
  );
}
