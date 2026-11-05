import { createRoot } from 'react-dom/client';
import { CanvasPanel } from './CanvasPanel.js';
import './canvas.css';

createRoot(document.getElementById('root')!).render(<CanvasPanel />);
