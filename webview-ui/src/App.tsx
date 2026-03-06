import './index.css';
import { useState, useCallback, useRef } from 'react';
import { OfficeState } from './office/engine/officeState.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { AgentLabels } from './components/AgentLabels.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ZoomControls } from './components/ZoomControls.js';
import { DebugView } from './components/DebugView.js';
import { AgentCard } from './components/AgentCard.js';
import { TelemetryDrawer } from './components/TelemetryDrawer.js';
import { EditorState } from './office/editor/editorState.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { vscode } from './vscodeApi.js';

const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) officeStateRef.current = new OfficeState();
  return officeStateRef.current;
}

export default function App() {
  const editor = useEditorActions(getOfficeState, editorState);
  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty]);
  const { agentTools, agentStatuses, layoutReady, agentDetail, setAgentDetail, telemetryEvents, clearTelemetry } = useExtensionMessages(
    getOfficeState,
    editor.setLastSavedLayout,
    isEditDirty
  );
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [telemetrySeenCount, setTelemetrySeenCount] = useState(0);
  const [cardPosition, setCardPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleUndo,
    editor.handleRedo,
    () => editor.handleEditorSelectionChange(null),
    editor.handleToggleEditMode
  );

  const handleDeskClick = useCallback((agentId: string, screenX: number, screenY: number) => {
    vscode.postMessage({ type: 'requestAgentDetail', agentId });
    setCardPosition({ x: screenX, y: screenY });
  }, []);

  const handleCloseCard = useCallback(() => {
    setAgentDetail(null);
    setCardPosition(null);
  }, [setAgentDetail]);

  const handleViewCharter = useCallback((agentId: string) => {
    vscode.postMessage({ type: 'openSquadAgent', agentId });
  }, []);

  const handleToggleTelemetry = useCallback(() => {
    setIsTelemetryOpen((prev) => {
      if (!prev) {
        setTelemetrySeenCount(telemetryEvents.length);
      }
      return !prev;
    });
  }, [telemetryEvents.length]);

  const handleClearTelemetry = useCallback(() => {
    clearTelemetry();
    setTelemetrySeenCount(0);
  }, [clearTelemetry]);

  if (!layoutReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-foreground)',
        }}
      >
        Loading office...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`@keyframes pixel-agents-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} } .pixel-agents-pulse{animation:pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite}`}</style>

      <OfficeCanvas
        officeState={getOfficeState()}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        onDeskClick={handleDeskClick}
      />

      <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--pixel-vignette)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      <AgentLabels officeState={getOfficeState()} zoom={editor.zoom} panRef={editor.panRef} />

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        isTelemetryOpen={isTelemetryOpen}
        onToggleTelemetry={handleToggleTelemetry}
        telemetryCount={telemetryEvents.length - telemetrySeenCount}
      />

      <TelemetryDrawer
        events={telemetryEvents}
        isOpen={isTelemetryOpen}
        onToggle={handleToggleTelemetry}
        onClear={handleClearTelemetry}
      />

      <ToolOverlay
        officeState={getOfficeState()}
        agentTools={agentTools}
        zoom={editor.zoom}
        panRef={editor.panRef}
      />

      {isDebugMode && (
        <DebugView
          officeState={getOfficeState()}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          onClose={() => setIsDebugMode(false)}
        />
      )}

      <AgentCard
        detail={agentDetail}
        position={cardPosition}
        onClose={handleCloseCard}
        onViewCharter={handleViewCharter}
      />
    </div>
  );
}
