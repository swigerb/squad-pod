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
import { SquadInfoCard } from './components/SquadInfoCard.js';
import { TelemetryDrawer } from './components/TelemetryDrawer.js';
import { MissingSquad } from './components/MissingSquad.js';
import { EditorToolbar } from './components/EditorToolbar.js';
import { EditorState } from './office/editor/editorState.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { AssetWarnings } from './components/AssetStatus.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { vscode } from './vscodeApi.js';
import { LayoutConflict } from './components/LayoutConflict.js';
import { DirectoryModal } from './components/DirectoryModal.js';

const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) officeStateRef.current = new OfficeState();
  return officeStateRef.current;
}

export default function App() {
  const editor = useEditorActions(getOfficeState, editorState);
  const { recordedUsage, assetStatus, settings, sourceStatus, directoryCatalog, directoryError, directoryNotice, updateSetting, agentTools, agentStatuses, layoutReady, noWorkspace, agentDetail, setAgentDetail, squadInfo, setSquadInfo, telemetryEvents, clearTelemetry } = useExtensionMessages(
    getOfficeState,
    editor.receiveLayout,
    editor.acknowledgeSave,
    editor.layoutError,
  );
  const isDebugMode = settings.debugEnabled;
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [telemetrySeenCount, setTelemetrySeenCount] = useState(0);
  const [isDirectoryModalOpen, setIsDirectoryModalOpen] = useState(false);
  const [cardPosition, setCardPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEditorKeyboard(
    editor.isEditMode && !isDirectoryModalOpen,
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

  const handleOpenSquadInfo = useCallback(() => {
    vscode.postMessage({ type: 'openSquadInfo' });
  }, []);

  const handleCloseSquadInfo = useCallback(() => {
    setSquadInfo(null);
  }, [setSquadInfo]);

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

  const handleOpenDirectories = useCallback(() => {
    setIsDirectoryModalOpen(true);
    vscode.postMessage({ type: 'getDirectories' });
  }, []);

  if (!layoutReady && !noWorkspace) {
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
        <LayoutConflict protection={editor.protection} onResolve={editor.resolveLayout} />
      </div>
    );
  }

  if (noWorkspace) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-foreground)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 500 }}>
          Open a folder to get started
        </div>
        <div style={{ fontSize: '14px', opacity: 0.7, maxWidth: '400px' }}>
          Squad Pod needs a workspace to discover your AI team. Open a folder with a Squad configuration to see your agents in action.
        </div>
        <button
          type="button"
          onClick={handleOpenDirectories}
          style={{
            padding: '8px 12px',
            border: 'none',
            borderRadius: '4px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            cursor: 'pointer',
          }}
        >
          Manage / Launch Directories
        </button>
        {isDirectoryModalOpen && (
          <DirectoryModal
            catalog={directoryCatalog}
            error={directoryError}
            notice={directoryNotice}
            onClose={() => setIsDirectoryModalOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="office-panel" data-edit-mode={editor.isEditMode} ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`@keyframes pixel-agents-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} } .pixel-agents-pulse{animation:pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite}`}</style>

      <OfficeCanvas
        isDebugMode={isDebugMode}
        officeState={getOfficeState()}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorEyedropper={editor.handleEyedropper}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        onExpandGrid={editor.handleExpandGrid}
        onGestureStart={editor.handleGestureStart}
        onGestureEnd={editor.handleGestureEnd}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        onDeskClick={handleDeskClick}
      />

      <EditorToolbar
        editorState={editorState}
        isEditMode={editor.isEditMode}
        onToolChange={editor.handleToolChange}
        onTileTypeChange={editor.handleTileTypeChange}
        onFloorColorChange={editor.handleFloorColorChange}
        onWallColorChange={editor.handleWallColorChange}
        onFurnitureTypeChange={editor.handleFurnitureTypeChange}
        activePetTypes={getOfficeState().getActivePetTypes()}
        onPetToggle={editor.handlePetToggle}
        onCarpetVariantChange={editor.handleCarpetVariantChange}
        onCarpetColorChange={editor.handleCarpetColorChange}
        onSave={editor.handleSave}
        onReset={editor.handleReset}
        onUndo={editor.handleUndo}
        onRedo={editor.handleRedo}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        isDirty={editor.isDirty}
        hasSelection={editorState.selectedFurnitureUid !== null}
        onExpandGrid={editor.handleExpandGrid}
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

      <AgentLabels officeState={getOfficeState()} zoom={editor.zoom} panRef={editor.panRef} onAgentClick={handleDeskClick} />

      <MissingSquad status={sourceStatus} />
      <LayoutConflict protection={editor.protection} onResolve={editor.resolveLayout} />
      <AssetWarnings status={assetStatus} furniture={getOfficeState().layout.furniture} />

      <BottomToolbar
        settings={settings}
        sourceStatus={sourceStatus}
        assetStatus={assetStatus}
        onSoundChange={(enabled) => updateSetting('soundEnabled', enabled)}
        isEditMode={editor.isEditMode}
        onToggleEditMode={editor.handleToggleEditMode}
        onOpenSquadInfo={handleOpenSquadInfo}
        isTelemetryOpen={isTelemetryOpen}
        onToggleTelemetry={handleToggleTelemetry}
        onOpenDirectories={handleOpenDirectories}
        telemetryCount={telemetryEvents.length - telemetrySeenCount}
        isDebugMode={isDebugMode}
        onToggleDebugMode={() => updateSetting('debugEnabled', !isDebugMode)}
      />

      <TelemetryDrawer
        recordedUsage={recordedUsage}
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
          onClose={() => updateSetting('debugEnabled', false)}
        />
      )}

      <AgentCard
        detail={agentDetail}
        position={cardPosition}
        onClose={handleCloseCard}
        onViewCharter={handleViewCharter}
      />

      <SquadInfoCard
        info={squadInfo}
        onClose={handleCloseSquadInfo}
      />
      {isDirectoryModalOpen && (
        <DirectoryModal
          catalog={directoryCatalog}
          error={directoryError}
          notice={directoryNotice}
          onClose={() => setIsDirectoryModalOpen(false)}
        />
      )}
    </div>
  );
}
