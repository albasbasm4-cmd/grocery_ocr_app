import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');
if (rootElement) ReactDOM.createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
