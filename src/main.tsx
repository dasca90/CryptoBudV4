import React from 'react';
import ReactDOM from 'react-dom/client';

const isAirScannerLabRoute = () => {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path.endsWith('/air-scanner-lab') || window.location.hash === '#/air-scanner-lab';
};

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (isAirScannerLabRoute()) {
  import('./features/air-scanner-lab/AirScannerLabPage').then(({ default: AirScannerLabPage }) => {
    root.render(
      <React.StrictMode>
        <AirScannerLabPage />
      </React.StrictMode>,
    );
  });
} else {
  import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
