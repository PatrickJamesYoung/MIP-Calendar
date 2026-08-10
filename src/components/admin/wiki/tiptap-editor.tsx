"use client";

/**
 * Tiptap-based WYSIWYG editor for wiki pages.
 *
 * Emits HTML into a hidden input under the given `name`, so the surrounding
 * server-action <form> can pick it up without any client-side submission
 * plumbing. This keeps the form architecture unchanged from the markdown
 * editor it replaces.
 */

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { useState, useCallback } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  Link as LinkIcon,
  Unlink,
  Minus,
  Table as TableIcon,
} from "lucide-react";

export function TiptapEditor({
  name,
  initialHtml,
  placeholder = "Write here…",
}: {
  name: string;
  initialHtml: string;
  placeholder?: string;
}) {
  // Mirror editor state into React so we can serialize into a hidden input
  // on every keystroke. Cheap: it's just a string reference swap.
  const [html, setHtml] = useState<string>(initialHtml);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit ships a Link extension already, but the standalone one
        // gives us better control over rel/target defaults.
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml || "",
    // SSR safety: Tiptap warns when it renders during SSR because contentEditable
    // is a client-only concern. immediatelyRender=false defers to the client.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // Keep the actual editable surface accessible; visual styling handled
        // by the wiki-prose class below via a wrapper.
        class:
          "wiki-prose min-h-[400px] focus:outline-none px-4 py-3",
      },
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
    },
  });

  return (
    <div
      className="border border-mip-gray-300 bg-white overflow-hidden"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {/* Hidden input carries the current HTML into the surrounding form. */}
      <input type="hidden" name={name} value={html} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previousUrl ?? "https://");
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    // Reserve space so the editor doesn't jump when it hydrates.
    return (
      <div className="h-11 border-b border-mip-gray-200 bg-mip-gray-50" />
    );
  }

  return (
    <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-mip-gray-200 bg-mip-gray-50">
      <ToolButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (⌘B)"
      >
        <Bold className="w-3.5 h-3.5" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (⌘I)"
      >
        <Italic className="w-3.5 h-3.5" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <Code className="w-3.5 h-3.5" />
      </ToolButton>

      <Divider />

      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="w-4 h-4" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Minus className="w-4 h-4" />
      </ToolButton>

      <Divider />

      <ToolButton
        onClick={setLink}
        active={editor.isActive("link")}
        title="Insert link"
      >
        <LinkIcon className="w-3.5 h-3.5" />
      </ToolButton>
      {editor.isActive("link") && (
        <ToolButton
          onClick={() =>
            editor.chain().focus().extendMarkRange("link").unsetLink().run()
          }
          title="Remove link"
        >
          <Unlink className="w-3.5 h-3.5" />
        </ToolButton>
      )}
      <ToolButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title="Insert 3×3 table"
      >
        <TableIcon className="w-3.5 h-3.5" />
      </ToolButton>

      <Divider />

      <ToolButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  onClick,
  active = false,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-8 h-8 transition-colors ${
        active
          ? "bg-mip-purple text-mip-white"
          : "text-mip-gray-700 hover:bg-mip-gray-200"
      }`}
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 mx-1 bg-mip-gray-300" />;
}
