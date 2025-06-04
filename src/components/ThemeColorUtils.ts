/**
 * Theme-aware color utility functions for Inlyne Editor
 * This helper provides functions to map colors appropriately based on the current VS Code theme
 */

/**
 * Parse a color string (hex, rgb, or named) and return RGB values
 * @param {string} color - The color string to parse
 * @returns {[number, number, number]} - Array of [r, g, b] values
 */
export function parseColor(color: string): [number, number, number] {
  // Create a temporary element to compute the color
  const tempElem = document.createElement('div');
  tempElem.style.color = color;
  tempElem.style.display = 'none';
  document.body.appendChild(tempElem);
  
  // Get computed style and extract RGB values
  const computedColor = getComputedStyle(tempElem).color;
  document.body.removeChild(tempElem);
  
  // Parse RGB values
  const match = computedColor.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }
  
  // Default return for black if parsing fails
  return [0, 0, 0];
}

/**
 * Determine if a color is light or dark
 * @param {[number, number, number]} rgb - RGB values
 * @returns {boolean} - True if color is light, false if dark
 */
export function isLightColor(rgb: [number, number, number]): boolean {
  // Calculate perceived brightness using ITU-R BT.709 formula
  const brightness = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
  return brightness > 0.5;
}

/**
 * Determine if the current VS Code theme is dark
 * @returns {boolean} - True if VS Code is using dark theme
 */
export function isDarkTheme(): boolean {
  // Check for VS Code-specific classes first
  if (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vs-dark')) {
    return true;
  }
  
  try {
    // Try localStorage (may not be available in strict environments)
    const savedTheme = localStorage.getItem('vscode-theme');
    if (savedTheme === 'dark') {
      return true;
    } else if (savedTheme === 'light') {
      return false;
    }
  } catch (e) {
    // Silently fail if localStorage is not available
  }
  
  // Check body background color as fallback
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const rgbMatch = bodyBg.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const [_, r, g, b] = rgbMatch.map(n => parseInt(n));
    const brightness = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    return brightness < 0.5;
  }
  
  // Default to light if all detection methods fail
  return false;
}

/**
 * Get the appropriate foreground color based on VS Code theme
 * @returns {string} The appropriate text color
 */
export function getThemeTextColor(): string {
  return isDarkTheme() 
    ? getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || '#e0e0e0'
    : getComputedStyle(document.body).getPropertyValue('--vscode-editor-foreground').trim() || '#333333';
}

/**
 * Map a color for proper display in current theme
 * This function helps ensure colors are visible in both light and dark themes
 * @param {string} originalColor - The original color string
 * @returns {string} - The mapped color appropriate for current theme
 */
export function mapColorForTheme(originalColor: string): string {
  // Parse the color into RGB
  const rgb = parseColor(originalColor);
  
  // Handle black/white specially
  const isWhite = rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250;
  const isBlack = rgb[0] < 10 && rgb[1] < 10 && rgb[2] < 10;
  
  // In dark theme
  if (isDarkTheme()) {
    // Replace black with theme foreground color
    if (isBlack) {
      return getThemeTextColor();
    }
    // Make other colors more vibrant if needed
    return originalColor;
  } 
  // In light theme
  else {
    // Replace white with theme foreground color
    if (isWhite) {
      return getThemeTextColor();
    }
    // Make other colors more vibrant if needed
    return originalColor;
  }
}
