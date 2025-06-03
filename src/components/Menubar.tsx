import React, { useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';

interface MenuBarProps {
  editor: Editor | null;
}

// A small utility to toggle boolean state on click
function ToggleButton({
  onClick,
  pressed,
  label,
}: {
  onClick: () => void;
  pressed: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 8px',
        marginRight: '4px',
        background: pressed ? '#ddd' : 'transparent',
        border: '1px solid #ccc',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '0.9rem',
      }}
    >
      {label}
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
    const cls = editor.getAttributes('textStyle').class as string | undefined;
    setInputSize(cls?.replace(/^fs-/, '') ?? '');
  };

  // Apply the chosen font size
  const applySize = () => {
    let size = inputSize.trim();
    if (!size) return;
    if (/^\d+(\.\d+)?$/.test(size)) {
      size = `${size}px`;
    }
    editor.chain().focus().setMark('textStyle', { class: `fs-${size}` }).run();
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
  const Options: {
    label: string;
    onClick: () => void;
    pressed: boolean;
  }[] = [
    {
      label: 'H1',
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      pressed: editor.isActive('heading', { level: 1 }),
    },
    {
      label: 'H2',
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      pressed: editor.isActive('heading', { level: 2 }),
    },
    {
      label: 'B',
      onClick: () => editor.chain().focus().toggleBold().run(),
      pressed: editor.isActive('bold'),
    },
    {
      label: 'I',
      onClick: () => editor.chain().focus().toggleItalic().run(),
      pressed: editor.isActive('italic'),
    },
    {
      label: 'UL',
      onClick: () => editor.chain().focus().toggleBulletList().run(),
      pressed: editor.isActive('bulletList'),
    },
    {
      label: 'OL',
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
      pressed: editor.isActive('orderedList'),
    },
    {
      label: 'HL',
      onClick: () => editor.chain().focus().toggleHighlight().run(),
      pressed: editor.isActive('highlight'),
    },
    {
      label: 'Align L',
      onClick: () => editor.chain().focus().setTextAlign('left').run(),
      pressed: editor.isActive({ textAlign: 'left' }),
    },
    {
      label: 'Align C',
      onClick: () => editor.chain().focus().setTextAlign('center').run(),
      pressed: editor.isActive({ textAlign: 'center' }),
    },
    {
      label: 'Align R',
      onClick: () => editor.chain().focus().setTextAlign('right').run(),
      pressed: editor.isActive({ textAlign: 'right' }),
    },
  ];

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
      <div style={{ position: 'relative', marginRight: '8px' }}>
        <input
          ref={inputRef}
          value={inputSize}
          onChange={e => setInputSize(e.target.value)}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          onKeyDown={e => e.key === 'Enter' && applySize()}
          placeholder="Font size"
          style={{
            width: '60px',
            padding: '4px',
            fontSize: '0.9rem',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        {dropdownOpen && (
          <ul
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              width: '60px',
              maxHeight: '120px',
              overflow: 'auto',
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '4px',
              zIndex: 10,
            }}
          >
            {PRESET_SIZES.map(sz => (
              <li
                key={sz}
                onMouseDown={e => {
                  e.preventDefault();
                  setInputSize(sz);
                  applySize();
                }}
                style={{
                  padding: '4px 6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {sz}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Formatting Toggles */}
      {Options.map((option, index) => (
        <ToggleButton
          key={index}
          pressed={option.pressed}
          onClick={option.onClick}
          label={option.label}
        />
      ))}

      {/* Color Picker */}
      <div style={{ position: 'relative', marginLeft: '8px' }}>
        <ToggleButton
          pressed={colorOpen}
          onClick={() => setColorOpen(o => !o)}
          label="Color"
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
        <ToggleButton
          pressed={imageOpen}
          onClick={() => setImageOpen(o => !o)}
          label="Image"
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

