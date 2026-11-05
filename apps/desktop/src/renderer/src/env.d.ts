/// <reference types="vite/client" />
import type { DoldariApi } from '../../preload/index';

declare global {
  interface Window {
    doldari: DoldariApi;
  }
}
