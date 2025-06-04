import React, { useState, useEffect } from 'react';
import './editor-styles.css';

/**
 * Component to test theme detection and color handling
 */
interface ThemeTesterProps {
  isDarkTheme: boolean;
  onToggleTheme?: () => void;
  show: boolean;
  onRequestClose: () => void;
}

const ThemeTester: React.FC<ThemeTesterProps> = ({ 
  isDarkTheme, 
  onToggleTheme,
  show,
  onRequestClose
}) => {
  if (!show) return null;
  
  const themeClass = isDarkTheme ? 'vscode-dark' : 'vscode-light';

  return (
    <div className={`theme-tester ${themeClass}`} style={{
      position: 'absolute',
      top: '40px',
      right: '20px',
      width: '300px',
      padding: '15px',
      background: isDarkTheme ? '#252526' : '#f3f3f3',
      border: '1px solid #EC6D26',
      borderRadius: '5px',
      zIndex: 1000,
      boxShadow: '0 0 10px rgba(0,0,0,0.2)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ margin: 0 }}>Theme Tester</h2>
        <button onClick={onRequestClose} style={{ 
          background: 'transparent', 
          border: 'none', 
          fontSize: '16px',
          cursor: 'pointer' 
        }}>✕</button>
      </div>
      
      <div style={{ marginBottom: '15px' }}>
        <p>Current theme: <strong>{isDarkTheme ? 'Dark' : 'Light'}</strong></p>
        {onToggleTheme && (
          <button onClick={onToggleTheme} style={{
            background: '#EC6D26',
            color: 'white',
            border: 'none',
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            marginTop: '5px'
          }}>
            Toggle Theme for Testing
          </button>
        )}
      </div>
      
      <h3>Default Text Colors</h3>
      <p>This text uses default coloring and should adapt to the current theme.</p>
      
      <h3>Text with Explicit Colors</h3>
      <div style={{ marginBottom: '10px' }}>
        <span style={{ color: 'black', marginRight: '5px' }}>Black text</span>
        <span style={{ color: 'white', marginRight: '5px' }}>White text</span>
        <span style={{ color: 'red', marginRight: '5px' }}>Red text</span>
        <span style={{ color: 'green', marginRight: '5px' }}>Green text</span>
        <span style={{ color: 'blue', marginRight: '5px' }}>Blue text</span>
        <span style={{ color: 'orange', marginRight: '5px' }}>Orange text</span>
      </div>
      
      <h3>RGB Color Variations</h3>
      <div style={{ marginBottom: '10px' }}>
        <span style={{ color: 'rgb(0,0,0)', marginRight: '5px' }}>Black RGB</span>
        <span style={{ color: 'rgb(255,255,255)', marginRight: '5px' }}>White RGB</span>
        <span style={{ color: 'rgb(255,0,0)', marginRight: '5px' }}>Red RGB</span>
        <span style={{ color: 'rgb(0,128,0)', marginRight: '5px' }}>Green RGB</span>
        <span style={{ color: 'rgb(0,0,255)', marginRight: '5px' }}>Blue RGB</span>
      </div>
      
      <h3>Background Colors</h3>
      <div style={{ marginBottom: '10px' }}>
        <span style={{ backgroundColor: 'black', color: 'white', padding: '3px', marginRight: '5px' }}>Black bg</span>
        <span style={{ backgroundColor: 'white', color: 'black', padding: '3px', marginRight: '5px' }}>White bg</span>
        <span style={{ backgroundColor: 'red', color: 'white', padding: '3px', marginRight: '5px' }}>Red bg</span>
        <span style={{ backgroundColor: 'green', color: 'white', padding: '3px', marginRight: '5px' }}>Green bg</span>
        <span style={{ backgroundColor: 'blue', color: 'white', padding: '3px', marginRight: '5px' }}>Blue bg</span>
      </div>
    </div>
  );
};

export default ThemeTester;
