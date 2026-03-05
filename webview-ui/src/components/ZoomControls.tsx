import { useState, useEffect } from 'react';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_LEVEL_FADE_DELAY_MS, ZOOM_LEVEL_HIDE_DELAY_MS, ZOOM_LEVEL_FADE_DURATION_SEC } from '../constants.js';

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const [showZoomLevel, setShowZoomLevel] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    setShowZoomLevel(true);
    setFadeOut(false);

    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, ZOOM_LEVEL_FADE_DELAY_MS);

    const hideTimer = setTimeout(() => {
      setShowZoomLevel(false);
    }, ZOOM_LEVEL_HIDE_DELAY_MS);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [zoom]);

  const handleZoomIn = () => {
    if (zoom < ZOOM_MAX) {
      onZoomChange(zoom + 1);
    }
  };

  const handleZoomOut = () => {
    if (zoom > ZOOM_MIN) {
      onZoomChange(zoom - 1);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <button
          onClick={handleZoomIn}
          disabled={zoom >= ZOOM_MAX}
          style={{
            width: '32px',
            height: '32px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: zoom >= ZOOM_MAX ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            opacity: zoom >= ZOOM_MAX ? 0.5 : 1,
          }}
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          disabled={zoom <= ZOOM_MIN}
          style={{
            width: '32px',
            height: '32px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: '4px',
            cursor: zoom <= ZOOM_MIN ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            opacity: zoom <= ZOOM_MIN ? 0.5 : 1,
          }}
        >
          −
        </button>
      </div>

      {showZoomLevel && (
        <div
          style={{
            background: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            textAlign: 'center',
            opacity: fadeOut ? 0 : 1,
            transition: `opacity ${ZOOM_LEVEL_FADE_DURATION_SEC}s ease-out`,
          }}
        >
          {zoom}x
        </div>
      )}
    </div>
  );
}
