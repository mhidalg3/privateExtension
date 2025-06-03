import { Editor } from '@tiptap/react';

/**
 * Maintains a consistent font size for new text in the editor
 */
class FontSizeManager {
  private editor: Editor;
  private currentFontSize: string | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /**
   * Validate and normalize a font size value
   */
  normalizeFontSize(size: string): string {
    // Ensure it has 'px' suffix
    if (/^\d+$/.test(size)) {
      size = `${size}px`;
    }
    
    // Ensure it's a valid pixel value
    if (!/^\d+(\.\d+)?px$/.test(size)) {
      return '16px'; // Return default size if invalid
    }
    
    return size;
  }
  
  /**
   * Set the current font size
   */
  setFontSize(size: string) {
    if (!size) {
      return;
    }
    
    // Normalize the size format
    size = this.normalizeFontSize(size);
    
    this.currentFontSize = size;
    
    // Store in the editor storage for persistence
    if (this.editor.storage.textStyle) {
      this.editor.storage.textStyle.currentFontSize = size;
    }

    // Apply to current selection
    this.applyFontSize();
  }

  /**
   * Apply the current font size to the selection
   */
  applyFontSize() {
    if (!this.currentFontSize) {
      return;
    }

    // First unset existing textStyle mark to avoid conflicts
    this.editor
      .chain()
      .focus()
      .unsetMark('textStyle')
      .run();
      
    // Then apply the new font size with both style and class
    this.editor
      .chain()
      .focus()
      .setMark('textStyle', { 
        style: `font-size: ${this.currentFontSize};`, 
        class: `fs-${this.currentFontSize}`
      })
      .run();
      
    // Log for debugging
    console.log(`Applied font size: ${this.currentFontSize}`);
  }

  /**
   * Get the current font size from the cursor position
   */
  getCurrentFontSize(): string {
    // Try to get from editor storage first
    if (this.editor.storage.textStyle?.currentFontSize) {
      return this.editor.storage.textStyle.currentFontSize;
    }

    // Check current attributes at cursor
    const attrs = this.editor.getAttributes('textStyle');
    
    // Try to extract from class
    if (attrs.class && typeof attrs.class === 'string' && attrs.class.startsWith('fs-')) {
      return attrs.class.replace(/^fs-/, '');
    }
    
    // Try to extract from style
    if (attrs.style && typeof attrs.style === 'string' && attrs.style.includes('font-size:')) {
      const match = attrs.style.match(/font-size:\s*([^;]+)/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    // Default font size if nothing is found
    return '16px';
  }

  /**
   * Update the current font size from cursor position
   */
  syncFromCursor() {
    this.currentFontSize = this.getCurrentFontSize();
    
    // Store in the editor storage for persistence
    if (this.editor.storage.textStyle) {
      this.editor.storage.textStyle.currentFontSize = this.currentFontSize;
    }
    
    return this.currentFontSize;
  }

  /**
   * Ensure the current font size is applied at cursor position
   */
  ensureApplied(): boolean {
    if (!this.currentFontSize || !this.editor.state.selection.empty) {
      return false;
    }
    
    const currentAttrs = this.editor.getAttributes('textStyle');
    
    // Check if current font size is already applied
    const hasClass = currentAttrs.class === `fs-${this.currentFontSize}`;
    const hasStyle = currentAttrs.style && 
                     currentAttrs.style.includes(`font-size: ${this.currentFontSize}`);
    
    // If font size is not applied, apply it
    if (!hasClass || !hasStyle) {
      this.applyFontSize();
      return true;
    }
    
    return false;
  }
}

export default FontSizeManager;
