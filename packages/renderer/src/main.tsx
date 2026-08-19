import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

// The theme is imported here, not in a component: it owns @import "tailwindcss" and the
// brand tokens, so it must be the first stylesheet in the bundle's cascade.
import './styles/theme.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html is missing its #root mount point');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
