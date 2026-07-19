import { Route, Routes } from 'react-router-dom'
import ThemeToggle from './components/common/ThemeToggle'
import ComparePage from './pages/ComparePage'
import HomePage from './pages/HomePage'
import TracePage from './pages/TracePage'

export default function App() {
  return (
    <>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/trace/:traceId" element={<TracePage />} />
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </>
  )
}
