import './index.css';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
import { SettingsModal } from './components/SettingsModal.js';
import { MissingSquad } from './components/MissingSquad.js';
import { EditorToolbar } from './components/EditorToolbar.js';
import { EditorState } from './office/editor/editorState.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { AssetWarnings } from './components/AssetStatus.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { PULSE_ANIMATION_DURATION_SEC } from './constants.js';
import { LayoutConflict } from './components/LayoutConflict.js';
import { DirectoryModal } from './components/DirectoryModal.js';
import { HostClientProvider, useHostClient } from './HostClientContext.js';
import { defaultHostClient, defaultHostError, type HostClient } from './hostClient.js';

const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();
const unsupportedHostMessage = 'Squad Pod needs its supported VS Code host. Run “Squad Pod: Show Panel” from VS Code; standalone browser transport is not available in this build.';

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) officeStateRef.current = new OfficeState();
  return officeStateRef.current;
}

export default function App({
  client = defaultHostClient,
  hostError = defaultHostError,
  readOnly = false,
  standalone = false,
}: {
  client?: HostClient | null;
  hostError?: string | null;
  readOnly?: boolean;
  standalone?: boolean;
} = {}) {
  if (!client) {
    return (
      <div role="alert" style={{ padding: '24px', color: 'var(--vscode-foreground)' }}>
        <h1>Host unavailable</h1>
        <p>{hostError
          ? `Squad Pod could not connect to its VS Code host: ${hostError}. ${unsupportedHostMessage}`
          : unsupportedHostMessage}</p>
      </div>
    );
  }
  return (
    <HostClientProvider client={client}>
      <ConnectedApp readOnly={readOnly} standalone={standalone} />
    </HostClientProvider>
  );
}

function ConnectedApp({ readOnly, standalone }: { readOnly: boolean; standalone: boolean }) {
  const client = useHostClient();
  const [recovery] = useState(() => {
    try {
      return { value: client.getState(), error: null };
    } catch (error) {
      return { value: undefined, error: String(error) };
    }
  });
  if (recovery.error !== null) {
    return (
      <div role="alert" style={{ padding: '24px', color: 'var(--vscode-foreground)' }}>
        <h1>Squad Pod could not read layout recovery state</h1>
        <p>{recovery.error}. {standalone
          ? 'Existing browser recovery data was not replaced. Recover or export that project/server storage before reconnecting.'
          : 'Reopen the panel after the VS Code host is available; existing recovery data was not replaced.'}</p>
      </div>
    );
  }
  return <ConnectedOffice recoveryState={recovery.value} readOnly={readOnly} standalone={standalone} />;
}

function ConnectedOffice({ recoveryState, readOnly, standalone }: { recoveryState: unknown; readOnly: boolean; standalone: boolean }) {
  const client = useHostClient();
  const editor = useEditorActions(getOfficeState, editorState, recoveryState, readOnly);
  const { observedTasks, recordedUsage, assetStatus, settings, sourceStatus, directoryCatalog, directoryError, directoryNotice, updateSetting, agents, agentTools, agentStatuses, layoutReady, noWorkspace, agentDetail, setAgentDetail, agentDetails, requestAgentDetail, squadInfo, setSquadInfo, telemetryEvents, clearTelemetry } = useExtensionMessages(
    getOfficeState,
    editor.receiveLayout,
    editor.acknowledgeSave,
    editor.layoutError,
    readOnly,
    standalone,
  );
  const isDebugMode = settings.debugEnabled;
  const [isTelemetryOpen, setIsTelemetryOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [telemetrySeenCount, setTelemetrySeenCount] = useState(0);
  const [isDirectoryModalOpen, setIsDirectoryModalOpen] = useState(false);
  const [isSquadInfoOpen, setIsSquadInfoOpen] = useState(false);
  const [cardPosition, setCardPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [touchMobile, setTouchMobile] = useState(false);

  useEffect(() => {
    if (!standalone) { setTouchMobile(false); return; }
    const query = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 700px), (pointer: coarse)') : null;
    const update = () => setTouchMobile((query?.matches ?? false) || navigator.maxTouchPoints > 0);
    update();
    query?.addEventListener('change', update);
    return () => query?.removeEventListener('change', update);
  }, [standalone]);

  useEffect(() => {
    if (touchMobile && editor.isEditMode) editor.handleToggleEditMode();
  }, [touchMobile, editor.isEditMode, editor.handleToggleEditMode]);

  useEffect(() => {
    if (agentDetail && !agents.includes(agentDetail.id)) {
      setAgentDetail(null);
      setCardPosition(null);
    }
  }, [agents, agentDetail, setAgentDetail]);

  useEditorKeyboard(
    editor.isEditMode && !touchMobile && !isDirectoryModalOpen,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleUndo,
    editor.handleRedo,
    () => editor.handleEditorSelectionChange(null),
    readOnly ? () => {} : editor.handleToggleEditMode
  );

  const handleDeskClick = useCallback((agentId: string, screenX: number, screenY: number) => {
    getOfficeState().selectedAgentId = agentId;
    setAgentDetail(null);
    setCardPosition({ x: screenX, y: screenY });
    requestAgentDetail(agentId);
  }, [requestAgentDetail, setAgentDetail]);

  const handleCloseCard = useCallback(() => {
    setAgentDetail(null);
    setCardPosition(null);
  }, [setAgentDetail]);

  const handleOpenSquadInfo = useCallback(() => {
    setIsSquadInfoOpen(true);
    if (readOnly || standalone) return;
    setSquadInfo(null);
    client.send({ type: 'openSquadInfo' });
  }, [client, readOnly, standalone, setSquadInfo]);

  const handleCloseSquadInfo = useCallback(() => {
    setIsSquadInfoOpen(false);
    setSquadInfo(null);
  }, [setSquadInfo]);

  const readOnlySquadInfo = useMemo(() => {
    if (!readOnly && !standalone) return null;
    const characters = getOfficeState().characters;
    const members = agents.flatMap((id) => {
      const character = characters.get(id);
      if (!character) return [];
      const status = agentStatuses[id] ?? 'unknown';
      return [{
        id, name: character.name, role: character.role, status,
        isActive: status === 'active', currentTask: null,
      }];
    });
    return {
      teamName: null, description: null, workspaceRoot: sourceStatus?.workspaceRoot ?? null,
      members, hiddenMembers: [], projectContext: null, totalAgents: members.length,
      activeAgents: members.filter((member) => member.isActive).length,
    };
  }, [agentStatuses, agents, readOnly, standalone, sourceStatus?.workspaceRoot]);

  const visibleSquadInfo = isSquadInfoOpen ? (readOnly || standalone ? readOnlySquadInfo : squadInfo) : null;
  const handleRequestSquadDetail = useCallback((agentId: string) => {
    const member = visibleSquadInfo?.members.find((candidate) => candidate.id === agentId);
    if (member && agents.includes(agentId) && visibleSquadInfo?.workspaceRoot === sourceStatus?.workspaceRoot) {
      requestAgentDetail(agentId);
    }
  }, [agents, requestAgentDetail, sourceStatus?.workspaceRoot, visibleSquadInfo]);

  const handleViewCharter = useCallback((agentId: string) => {
    client.send({ type: 'openSquadAgent', agentId });
  }, [client]);

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
    client.send({ type: 'getDirectories' });
  }, [client]);
  const selectedFurnitureColor = getOfficeState().layout.furniture
    .find((furniture) => furniture.uid === editorState.selectedFurnitureUid)?.color ?? null;

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
        <LayoutConflict standalone={standalone} protection={editor.protection} onResolve={editor.resolveLayout} />
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
        readOnly={readOnly}
        isDebugMode={isDebugMode}
        officeState={getOfficeState()}
        isEditMode={editor.isEditMode && !touchMobile}
        showAreas={settings.showAreas}
        editorState={editorState}
        furnitureColorPickTarget={editor.furnitureColorPickTarget}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorEyedropper={editor.handleEyedropper}
        onEditorFurnitureColorPick={editor.handleFurnitureColorPick}
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
        touchGestures={touchMobile}
      />

      {!touchMobile && <EditorToolbar
        editorState={editorState}
        isEditMode={editor.isEditMode}
        onToolChange={editor.handleToolChange}
        onTileTypeChange={editor.handleTileTypeChange}
        onFloorColorChange={editor.handleFloorColorChange}
        onWallColorChange={editor.handleWallColorChange}
        onFurnitureTypeChange={editor.handleFurnitureTypeChange}
        furniturePaletteColor={editor.furniturePaletteColor}
        selectedFurnitureColor={selectedFurnitureColor}
        onFurniturePaletteColorChange={editor.handleFurniturePaletteColorChange}
        onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
        onFurnitureColorPickToggle={editor.handleFurnitureColorPickToggle}
        furnitureColorPickTarget={editor.furnitureColorPickTarget}
        onColorGestureStart={editor.handleGestureStart}
        onColorGestureEnd={editor.handleGestureEnd}
        activePetTypes={getOfficeState().getActivePetTypes()}
        onPetToggle={editor.handlePetToggle}
        onCarpetVariantChange={editor.handleCarpetVariantChange}
        onCarpetColorChange={editor.handleCarpetColorChange}
        areas={getOfficeState().layout.areas ?? []}
        areaMappings={getOfficeState().layout.areaMappings}
        directories={[
          ...(directoryCatalog?.workspaceDirectories ?? []),
          ...(directoryCatalog?.savedDirectories ?? []),
        ]}
        selectedAreaLabel={editorState.selectedAreaLabel}
        transformError={editorState.transformError}
        onAreaAdd={editor.handleAreaAdd}
        onAreaRename={editor.handleAreaRename}
        onAreaColorChange={editor.handleAreaColorChange}
        onAreaRemove={editor.handleAreaRemove}
        onAreaMappingChange={editor.handleAreaMappingChange}
        onAreaSelect={editor.handleAreaSelect}
        onSave={editor.handleSave}
        onReset={editor.handleReset}
        onUndo={editor.handleUndo}
        onRedo={editor.handleRedo}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onToggleSelectedState={editor.handleToggleState}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        canToggleSelectedState={editor.canToggleSelectedState}
        isSelectedFurnitureOn={editor.isSelectedFurnitureOn}
        isDirty={editor.isDirty}
        hasSelection={editorState.selectedFurnitureUid !== null}
        onExpandGrid={editor.handleExpandGrid}
      />}

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
      {readOnly && sourceStatus?.teamFound && sourceStatus.error && (
        <p role="alert" style={{ position: 'absolute', top: 0, right: 12, maxWidth: '70%', maxHeight: '30%', overflow: 'auto', zIndex: 45, padding: 12, background: 'var(--vscode-editor-background)', whiteSpace: 'pre-wrap' }}>
          {sourceStatus.error}
        </p>
      )}
      <LayoutConflict standalone={standalone} protection={editor.protection} onResolve={editor.resolveLayout} />
      <AssetWarnings status={assetStatus} furniture={getOfficeState().layout.furniture} />

      <BottomToolbar
        nativeUnavailable={standalone}
        onOpenSettings={() => setShowSettings(true)}
        readOnly={readOnly}
        hideEditor={touchMobile}
        isEditMode={editor.isEditMode && !touchMobile}
        onToggleEditMode={editor.handleToggleEditMode}
        onOpenSquadInfo={handleOpenSquadInfo}
        isTelemetryOpen={isTelemetryOpen}
        onToggleTelemetry={handleToggleTelemetry}
        onOpenDirectories={handleOpenDirectories}
        telemetryCount={telemetryEvents.length - telemetrySeenCount}
      />

      <TelemetryDrawer
        sourceStatus={sourceStatus}
        onOpenSettings={() => setShowSettings(true)}
        readOnly={readOnly || standalone}
        observedTasks={observedTasks}
        liveSource={sourceStatus?.liveActivity}
        recordedUsage={recordedUsage}
        events={telemetryEvents}
        isOpen={isTelemetryOpen}
        onToggle={handleToggleTelemetry}
        onClear={handleClearTelemetry}
      />
      {showSettings && !readOnly && <SettingsModal standalone={standalone} onClose={() => setShowSettings(false)} isDebugMode={isDebugMode}
        onToggleDebugMode={() => updateSetting('debugEnabled', !isDebugMode)}
        settings={settings} sourceStatus={sourceStatus} assetStatus={assetStatus}
        onSoundChange={(enabled) => updateSetting('soundEnabled', enabled)}
        onShowAreasChange={(enabled) => updateSetting('showAreas', enabled)} />}

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
        detail={agentDetail && getOfficeState().characters.has(agentDetail.id) ? agentDetail : null}
        position={cardPosition}
        onClose={handleCloseCard}
        onViewCharter={readOnly || standalone ? undefined : handleViewCharter}
      />

      <SquadInfoCard
        info={visibleSquadInfo}
        agentDetails={agentDetails}
        availableAgentIds={agents}
        onRequestAgentDetail={handleRequestSquadDetail}
        onOpenCharter={readOnly || standalone ? undefined : handleViewCharter}
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
