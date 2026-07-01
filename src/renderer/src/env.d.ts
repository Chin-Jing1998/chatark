/// <reference types="vite/client" />
import type { ChatArkApi } from '@shared/api'

declare global {
  interface Window {
    api: ChatArkApi
  }
}

export {}
