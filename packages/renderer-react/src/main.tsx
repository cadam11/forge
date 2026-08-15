import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html is missing its #root mount point');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
