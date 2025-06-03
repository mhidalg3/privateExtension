import React, { useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { ReactNode } from 'react';
import {
  FaHeading, FaBold, FaItalic, FaStrikethrough,
  FaAlignLeft, FaAlignCenter, FaAlignRight,
  FaListUl, FaListOl, FaHighlighter, FaTint, FaImage
} from 'react-icons/fa';

interface MenuBarProps {
  editor: Editor | null;
}

// A small utility to toggle boolean state on click
function IconButton({
  onClick,
  pressed,
  icon,
  label,
}: {
  onClick: () => void;
  pressed: boolean;
  icon: ReactNode;
  label?: string; // optional tooltip
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        padding: '6px',
        marginRight: '4px',
        background: pressed ? '#ddd' : 'transparent',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        height: '32px',
      }}
    >
      {icon}
    </button>
  );
}

const PRESET_SIZES = ['8px', '10px', '12px', '14px', '16px', '18px', '24px', '32px', '48px'];

export default function MenuBar({ editor }: MenuBarProps) {
  const [inputSize, setInputSize] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [colorOpen, setColorOpen] = useState(false);
  const [colorValue, setColorValue] = useState('#000000');

  const [imageOpen, setImageOpen] = useState(false);
  const [imageValue, setImageValue] = useState('');

  if (!editor) {
    return null;
  }

  // Keep the input in sync when cursor moves
  const syncSize = () => {
    const attrs = editor.getAttributes('textStyle');
    if (attrs?.fontSize) {
      setInputSize(attrs.fontSize.replace('px', ''));
    } else {
      const selection = window.getSelection();
      const element = selection?.anchorNode?.parentElement;
      if (element) {
        const computed = getComputedStyle(element).fontSize;
        setInputSize(computed.replace('px', ''));
      }
    }
  };


  // Apply font size using `fontSize` in style
  const applySize = () => {
    let size = inputSize.trim();
    if (!size) return;
    if (/^\d+(\.\d+)?$/.test(size)) {
      size = `${size}px`;
    }

    // Apply to current selection
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();

    // Force re-setting the stored style by re-applying at the selection
    // so it doesn't get cleared on next input
    const { state, view } = editor;
    const { from, to, empty } = state.selection;

    if (empty) {
      // This persists style for new input
      const transaction = state.tr.setStoredMarks([
        editor.schema.marks.textStyle.create({ fontSize: size }),
      ]);
      view.dispatch(transaction);
    }

    syncSize();
  };


  // Apply the chosen color
  const applyColor = () => {
    editor.chain().focus().setMark('textStyle', { color: colorValue }).run();
    setColorOpen(false);
  };

  // Apply the entered image URL
  const applyImage = () => {
    if (imageValue.trim()) {
      editor.chain().focus().setImage({ src: imageValue.trim() }).run();
    }
    setImageOpen(false);
  };

  // Attach and clean up selectionUpdate listener
  useEffect(() => {
    editor.on('selectionUpdate', syncSize);
    syncSize();
    return () => {
      editor.off('selectionUpdate', syncSize);
    };
  }, [editor]);

  // Define the basic formatting options
  const Options = [
    {
      icon: <span style={{ fontSize: '0.9em' }}>H₁</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      pressed: editor.isActive('heading', { level: 1 }),
      label: 'Heading 1',
    },
    {
      icon: <span style={{ fontSize: '0.9em' }}>H₂</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      pressed: editor.isActive('heading', { level: 2 }),
      label: 'Heading 2',
    },
    {
      icon: <span style={{ fontSize: '0.9em' }}>H₃</span>,
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      pressed: editor.isActive('heading', { level: 3 }),
      label: 'Heading 3',
    },
    {
      icon: <FaBold />,
      onClick: () => editor.chain().focus().toggleBold().run(),
      pressed: editor.isActive('bold'),
      label: 'Bold',
    },
    {
      icon: <FaItalic />,
      onClick: () => editor.chain().focus().toggleItalic().run(),
      pressed: editor.isActive('italic'),
      label: 'Italic',
    },
    {
      icon: <FaStrikethrough />,
      onClick: () => editor.chain().focus().toggleStrike().run(),
      pressed: editor.isActive('strike'),
      label: 'Strikethrough',
    },
    {
      icon: <FaAlignLeft />,
      onClick: () => editor.chain().focus().setTextAlign('left').run(),
      pressed: editor.isActive({ textAlign: 'left' }),
      label: 'Align Left',
    },
    {
      icon: <FaAlignCenter />,
      onClick: () => editor.chain().focus().setTextAlign('center').run(),
      pressed: editor.isActive({ textAlign: 'center' }),
      label: 'Align Center',
    },
    {
      icon: <FaAlignRight />,
      onClick: () => editor.chain().focus().setTextAlign('right').run(),
      pressed: editor.isActive({ textAlign: 'right' }),
      label: 'Align Right',
    },
    {
      icon: <FaListUl />,
      onClick: () => editor.chain().focus().toggleBulletList().run(),
      pressed: editor.isActive('bulletList'),
      label: 'Bullet List',
    },
    {
      icon: <FaListOl />,
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
      pressed: editor.isActive('orderedList'),
      label: 'Ordered List',
    },
  ];

  const applyFontSize = (size: string) => {
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: '#f9f9f9',
        padding: '4px 8px',
        borderBottom: '1px solid #ddd',
      }}
    >
      {/* Font-Size Dropdown */}
      <div style={{ marginRight: '8px' }}>
        <select
          onChange={e => applyFontSize(e.target.value)}
          defaultValue=""
          style={{
            padding: '4px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '0.9rem',
          }}
        >
          <option value="" disabled>Font Size</option>
          {PRESET_SIZES.map(size => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>


      {/* Formatting Toggles */}
      {Options.map((opt, idx) => (
        <IconButton
          key={idx}
          icon={opt.icon}
          onClick={opt.onClick}
          pressed={opt.pressed}
          label={opt.label}
        />
      ))}

      <IconButton
        icon={<FaHighlighter />}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        pressed={editor.isActive('highlight')}
        label="Highlight"
      />

      {/* Color Picker */}
      <div style={{ position: 'relative', marginLeft: '8px' }}>
        <IconButton
          icon={<FaTint />}
          pressed={colorOpen}
          onClick={() => setColorOpen(o => !o)}
          label="Text Color"
        />

        {colorOpen && (
          <input
            type="color"
            value={colorValue}
            onChange={e => setColorValue(e.target.value)}
            onBlur={applyColor}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              width: '32px',
              height: '32px',
              border: 'none',
              padding: 0,
            }}
          />
        )}
      </div>

      {/* Image URL */}
      <div style={{ position: 'relative', marginLeft: '8px' }}>
        <IconButton
          icon={<FaImage />}
          pressed={imageOpen}
          onClick={() => setImageOpen(o => !o)}
          label="Insert Image"
        />
        {imageOpen && (
          <input
            type="text"
            value={imageValue}
            onChange={e => setImageValue(e.target.value)}
            onBlur={applyImage}
            onKeyDown={e => e.key === 'Enter' && applyImage()}
            placeholder="Image URL"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              width: '120px',
              padding: '4px',
              fontSize: '0.9rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: '#fff',
            }}
          />
        )}
      </div>
    </div>
  );
}

