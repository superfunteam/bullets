import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import { App } from './App';
import { SelectionProvider } from './views/selection';
import { watchTextScale } from './design/textScale';

// Before first paint, so layouts that reflow for large system text never flash
// the wrong arrangement.
watchTextScale();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SelectionProvider>
      <App />
    </SelectionProvider>
  </StrictMode>,
);
