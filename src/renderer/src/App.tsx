import { ThemeProvider } from './lib/useTheme'
import { StoreProvider } from './app/store'
import Layout from './app/Layout'
import { Toaster } from './components/ui/sonner'

export default function App(): JSX.Element {
  return (
    <ThemeProvider>
      <StoreProvider>
        <Layout />
        <Toaster position="bottom-right" />
      </StoreProvider>
    </ThemeProvider>
  )
}
