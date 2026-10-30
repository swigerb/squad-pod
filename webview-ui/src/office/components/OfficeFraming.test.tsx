import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OfficeCanvas } from './OfficeCanvas.js';
import { ZoomControls } from '../../components/ZoomControls.js';
import { OfficeState } from '../engine/officeState.js';
import { EditorState } from '../editor/editorState.js';
import { HostClientProvider } from '../../HostClientContext.js';
import { createHostClientFixture } from '../../__tests__/hostClientFixture.js';
import * as gameLoop from '../engine/gameLoop.js';
import * as renderer from '../engine/renderer.js';
import type { CameraRequest } from '../engine/viewport.js';
import { getCharacterScreenBounds } from '../engine/characterGeometry.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([1.5, 2, 3])('fits and locates once at DPR %s; resize and manual navigation never save/re-fit the layout', dpr => {
  vi.stubGlobal('devicePixelRatio', dpr);
  let width = 788;
  const height = 600;
  const ctx = { setTransform: vi.fn(), imageSmoothingEnabled: false };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
  }));
  vi.spyOn(renderer, 'renderFrame').mockImplementation(() => {});
  let renderFrame = () => {};
  vi.spyOn(gameLoop, 'startGameLoop').mockImplementation((_canvas, callbacks) => {
    renderFrame = () => callbacks.render(ctx as unknown as CanvasRenderingContext2D);
    return () => {};
  });
  const office = new OfficeState({ version: 2, cols: 21, rows: 15, tiles: Array(315).fill(1), furniture: [] });
  office.addAgent('ada', 'Ada', 'Developer');
  Object.assign(office.characters.get('ada')!, { x: 300, y: 120 });
  const before = JSON.stringify(office.layout);
  const client = createHostClientFixture();
  const pan = { current: { x: 0, y: 0 } };
  const host = document.createElement('div');
  const root = createRoot(host);
  function Fixture() {
    const [zoom, setZoom] = useState(3);
    const [request, setRequest] = useState<CameraRequest>();
    return <HostClientProvider client={client}>
      <OfficeCanvas officeState={office} editorState={new EditorState()} isEditMode={false} editorTick={0}
        zoom={zoom} onZoomChange={setZoom} panRef={pan} cameraRequest={request} />
      <ZoomControls zoom={zoom} onZoomChange={setZoom} onFitOffice={() => setRequest({ id: 1 })} />
      <button onClick={() => setRequest({ id: 2, agentId: 'ada' })}>Locate Ada</button>
    </HostClientProvider>;
  }
  const click = (name: string) => act(() => [...host.querySelectorAll('button')]
    .find(button => button.getAttribute('aria-label') === name || button.textContent === name)!.click());
  try {
    act(() => root.render(<Fixture />));
    act(() => renderFrame());
    expect(pan.current.x).toBe(-110); // 21*16*3=1008 CSS pixels, not a pathfinding escape.
    click('Fit and center office');
    act(() => renderFrame());
    expect(pan.current).toEqual({ x: 58, y: 60 });
    expect(host.querySelector('canvas')!.width).toBe(Math.round(width * dpr));
    click('Zoom in');
    act(() => renderFrame());
    expect(pan.current.x).toBe(-110);
    pan.current.x = -150; // A deliberate in-range manual pan.
    act(() => renderFrame());
    expect(pan.current.x).toBe(-150);
    width = 360;
    act(() => renderFrame());
    expect(pan.current.x).toBe(-150); // Resize clamps, but does not fit/chase.
    click('Locate Ada');
    act(() => renderFrame());
    const bounds = getCharacterScreenBounds(office.characters.get('ada')!, 3, pan.current);
    expect((bounds.left + bounds.right) / 2).toBe(180);
    const located = { ...pan.current };
    office.characters.get('ada')!.x -= 20;
    act(() => renderFrame());
    expect(pan.current).toEqual(located); // Locate is not follow.
    vi.stubGlobal('devicePixelRatio', 2);
    act(() => renderFrame());
    expect(host.querySelector('canvas')!.width).toBe(720);
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    expect(JSON.stringify(office.layout)).toBe(before);
    expect(client.send).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
