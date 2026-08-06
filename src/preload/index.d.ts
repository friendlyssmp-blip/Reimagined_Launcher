import type { ReimaginedApi } from './index'

declare global {
  interface Window {
    reimagined: ReimaginedApi
  }
}

export {}
