'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback, useEffect } from 'react';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  disabled?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = '本文を入力',
  minHeight = '200px',
  className = '',
  disabled = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'rich-text-editor-body min-h-[120px] px-3 py-2 focus:outline-none text-sm text-[#1f2937]',
      },
    },
  });

  // 親から渡された value が外部で変わったとき（例: 別投稿を編集）だけ同期
  useEffect(() => {
    if (!editor) return;
    if (value === editor.getHTML()) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  const setParagraph = useCallback(() => {
    editor?.chain().focus().setParagraph().run();
  }, [editor]);

  const setHeading = useCallback((level: 1 | 2 | 3) => {
    editor?.chain().focus().toggleHeading({ level }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div
        className={`rounded-lg border border-[#e5e7eb] bg-white ${className}`}
        style={{ minHeight }}
      >
        <div className="px-3 py-2 text-sm text-gray-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-[#e5e7eb] bg-white focus-within:ring-2 focus-within:ring-[#3b82f6] focus-within:border-[#3b82f6] ${className}`}
      style={{ minHeight }}
    >
      {/* ツールバー */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#e5e7eb] px-1 py-1">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="太字"
        >
          <span className="font-bold text-sm">B</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="斜体"
        >
          <span className="italic text-sm">I</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="取り消し線"
        >
          <span className="text-sm line-through">S</span>
        </ToolbarButton>
        <span className="w-px h-5 bg-gray-200 mx-1" aria-hidden />
        <ToolbarButton
          onClick={setParagraph}
          isActive={editor.isActive('paragraph')}
          title="通常"
        >
          <span className="text-xs">段落</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setHeading(1)}
          isActive={editor.isActive('heading', { level: 1 })}
          title="見出し1（大）"
        >
          <span className="text-xs font-bold">H1</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setHeading(2)}
          isActive={editor.isActive('heading', { level: 2 })}
          title="見出し2（中）"
        >
          <span className="text-xs font-bold">H2</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setHeading(3)}
          isActive={editor.isActive('heading', { level: 3 })}
          title="見出し3（小）"
        >
          <span className="text-xs font-bold">H3</span>
        </ToolbarButton>
      </div>
      <div className="rich-text-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  isActive,
  title,
  children,
}: {
  onClick: () => void;
  isActive: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded text-[#4b5563] hover:bg-gray-100 hover:text-[#1f2937] ${isActive ? 'bg-gray-200 text-[#1f2937]' : ''}`}
    >
      {children}
    </button>
  );
}
