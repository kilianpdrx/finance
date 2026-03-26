import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useThemeStore } from './store'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Accounts from './pages/Accounts'
import Analytics from './pages/Analytics'
import Budget from './pages/Budget'
import Upload from './pages/Upload'
import Settings from './pages/Settings'
import Investments from './pages/Investments'

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const { isDark } = useThemeStore()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/transactions" element={<Layout><Transactions /></Layout>} />
        <Route path="/comptes" element={<Layout><Accounts /></Layout>} />
        <Route path="/analyses" element={<Layout><Analytics /></Layout>} />
        <Route path="/budget" element={<Layout><Budget /></Layout>} />
        <Route path="/investissements" element={<Layout><Investments /></Layout>} />
        <Route path="/importer" element={<Layout><Upload /></Layout>} />
        <Route path="/parametres" element={<Layout><Settings /></Layout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
